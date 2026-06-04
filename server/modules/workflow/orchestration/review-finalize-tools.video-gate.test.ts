import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { createReviewFinalizeTools } from "./review-finalize-tools.ts";

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      department_id TEXT,
      source_task_id TEXT,
      project_id TEXT,
      workflow_pack_key TEXT,
      project_path TEXT,
      workflow_meta_json TEXT,
      assigned_agent_id TEXT,
      completed_at INTEGER,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );

    CREATE TABLE subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL,
      delegated_task_id TEXT,
      blocked_reason TEXT,
      completed_at INTEGER
    );

    CREATE TABLE task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER
    );

    CREATE TABLE api_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      base_url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE guild_agent_roles (
      guild_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      role_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      model TEXT NOT NULL,
      PRIMARY KEY (guild_id, agent_id)
    );

    CREATE TABLE guild_runtime_bindings (
      guild_id TEXT NOT NULL,
      guild_agent_id TEXT NOT NULL,
      runtime_agent_id TEXT NOT NULL,
      api_provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      updated_at INTEGER,
      PRIMARY KEY (guild_id, guild_agent_id)
    );
  `);
  return db;
}

describe("review finalize video gate", () => {
  it("routes Guild AI QA approval through qa_pass instead of generic finalization", () => {
    const db = createDb();
    try {
      const taskId = "guild-qa-pass";
      db.prepare(
        `
          INSERT INTO tasks (
            id, title, status, department_id, source_task_id, project_id, workflow_pack_key, project_path,
            workflow_meta_json, assigned_agent_id, created_at, updated_at
          )
          VALUES (?, ?, 'review', 'qa', NULL, 'project-1', 'development', ?, ?, 'qa-runtime', 1, 1)
        `,
      ).run(taskId, "QA review", "/tmp/project", JSON.stringify({ guildId: "ecom-001", currentGuildRole: "qa" }));

      const appendTaskLog = vi.fn();
      const tools = createReviewFinalizeTools({
        db,
        nowMs: () => 1700000000000,
        broadcast: vi.fn(),
        appendTaskLog,
        getPreferredLanguage: () => "ko",
        pickL: (pool: any) => (Array.isArray(pool?.ko) ? pool.ko[0] : ""),
        l: (ko: string[], en: string[], ja: string[], zh: string[]) => ({ ko, en, ja, zh }),
        resolveLang: () => "ko",
        getProjectReviewGateSnapshot: () => ({ activeReview: 1, activeTotal: 1, ready: true }),
        projectReviewGateNotifiedAt: new Map<string, number>(),
        notifyCeo: vi.fn(),
        taskWorktrees: new Map<string, { worktreePath: string; projectPath: string; branchName: string }>(),
        mergeToDevAndCreatePR: vi.fn(() => ({ success: true, message: "pr created" })),
        mergeWorktree: vi.fn(() => ({ success: true, message: "merged" })),
        cleanupWorktree: vi.fn(),
        findTeamLeader: vi.fn(() => null),
        getAgentDisplayName: vi.fn(() => "팀장"),
        setTaskCreationAuditCompletion: vi.fn(),
        endTaskExecutionSession: vi.fn(),
        notifyTaskStatus: vi.fn(),
        refreshCliUsageData: vi.fn(async () => ({})),
        shouldDeferTaskReportUntilPlanningArchive: vi.fn(() => false),
        emitTaskReportEvent: vi.fn(),
        formatTaskSubtaskProgressSummary: vi.fn(() => ""),
        reviewRoundState: new Map<string, number>(),
        reviewInFlight: new Set<string>(),
        archivePlanningConsolidatedReport: vi.fn(async () => undefined),
        crossDeptNextCallbacks: new Map<string, () => void>(),
        recoverCrossDeptQueueAfterMissingCallback: vi.fn(),
        subtaskDelegationCallbacks: new Map<string, () => void>(),
        startReviewConsensusMeeting: (_taskId: string, _taskTitle: string, _dept: string, onApproved: () => void) => {
          onApproved();
        },
      } as any);

      tools.finishReview(taskId, "QA review", {
        bypassProjectDecisionGate: true,
        trigger: "test",
      });

      const updated = db
        .prepare("SELECT status, assigned_agent_id, workflow_meta_json FROM tasks WHERE id = ?")
        .get(taskId) as { status: string; assigned_agent_id: string | null; workflow_meta_json: string };
      expect(updated.status).toBe("done");
      expect(updated.assigned_agent_id).toBeNull();
      expect(JSON.parse(updated.workflow_meta_json)).toMatchObject({
        routeDecision: "qa_pass",
        currentGuildRole: null,
      });
      expect(appendTaskLog).toHaveBeenCalledWith(
        taskId,
        "system",
        expect.stringContaining("Guild AI review route: qa_pass"),
      );
    } finally {
      db.close();
    }
  });

  it("video_preprod task는 final.mp4 확인 전 승인/머지를 진행하지 않는다", () => {
    const db = createDb();
    try {
      const taskId = "task-video-1";
      db.prepare(
        `
          INSERT INTO tasks (id, title, status, department_id, source_task_id, project_id, workflow_pack_key, project_path, created_at, updated_at)
          VALUES (?, ?, 'review', 'planning', NULL, 'project-1', 'video_preprod', ?, 1, 1)
        `,
      ).run(taskId, "Video intro", "/tmp/non-existing-video-root");

      const appendTaskLog = vi.fn();
      const notifyCeo = vi.fn();
      const startReviewConsensusMeeting = vi.fn();
      const mergeWorktree = vi.fn(() => ({ success: true, message: "merged" }));

      const tools = createReviewFinalizeTools({
        db,
        nowMs: () => 1700000000000,
        broadcast: vi.fn(),
        appendTaskLog,
        getPreferredLanguage: () => "ko",
        pickL: (pool: any) => (Array.isArray(pool?.ko) ? pool.ko[0] : ""),
        l: (ko: string[], en: string[], ja: string[], zh: string[]) => ({ ko, en, ja, zh }),
        resolveLang: () => "ko",
        getProjectReviewGateSnapshot: () => ({ activeReview: 1, activeTotal: 1, ready: true }),
        projectReviewGateNotifiedAt: new Map<string, number>(),
        notifyCeo,
        taskWorktrees: new Map<string, { worktreePath: string; projectPath: string; branchName: string }>(),
        mergeToDevAndCreatePR: vi.fn(() => ({ success: true, message: "pr created" })),
        mergeWorktree,
        cleanupWorktree: vi.fn(),
        findTeamLeader: vi.fn(() => null),
        getAgentDisplayName: vi.fn(() => "팀장"),
        setTaskCreationAuditCompletion: vi.fn(),
        endTaskExecutionSession: vi.fn(),
        notifyTaskStatus: vi.fn(),
        refreshCliUsageData: vi.fn(async () => ({})),
        shouldDeferTaskReportUntilPlanningArchive: vi.fn(() => false),
        emitTaskReportEvent: vi.fn(),
        formatTaskSubtaskProgressSummary: vi.fn(() => ""),
        reviewRoundState: new Map<string, number>(),
        reviewInFlight: new Set<string>(),
        archivePlanningConsolidatedReport: vi.fn(async () => undefined),
        crossDeptNextCallbacks: new Map<string, () => void>(),
        recoverCrossDeptQueueAfterMissingCallback: vi.fn(),
        subtaskDelegationCallbacks: new Map<string, () => void>(),
        startReviewConsensusMeeting,
      } as any);

      tools.finishReview(taskId, "Video intro", {
        bypassProjectDecisionGate: true,
        trigger: "test",
      });

      const updated = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string };
      expect(updated.status).toBe("review");
      expect(startReviewConsensusMeeting).not.toHaveBeenCalled();
      expect(mergeWorktree).not.toHaveBeenCalled();
      expect(appendTaskLog).toHaveBeenCalledWith(
        taskId,
        "system",
        expect.stringContaining("Review hold: video artifact gate blocked approval"),
      );
      expect(notifyCeo).toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("video artifact가 있어도 Remotion 증빙이 없으면 승인/머지를 차단한다", () => {
    const db = createDb();
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "climpire-review-gate-"));
    const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "climpire-review-logs-"));
    try {
      const taskId = "task-video-remotion-missing";
      const outputDir = path.join(projectRoot, "video_output");
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, "final.mp4"), "dummy-video", "utf8");

      db.prepare(
        `
          INSERT INTO tasks (id, title, status, department_id, source_task_id, project_id, workflow_pack_key, project_path, created_at, updated_at)
          VALUES (?, ?, 'review', 'planning', NULL, 'project-1', 'video_preprod', ?, 1, 1)
        `,
      ).run(taskId, "Video intro", projectRoot);

      const appendTaskLog = vi.fn();
      const notifyCeo = vi.fn();
      const startReviewConsensusMeeting = vi.fn();
      const mergeWorktree = vi.fn(() => ({ success: true, message: "merged" }));

      const tools = createReviewFinalizeTools({
        db,
        nowMs: () => 1700000000000,
        logsDir,
        broadcast: vi.fn(),
        appendTaskLog,
        getPreferredLanguage: () => "ko",
        pickL: (pool: any) => (Array.isArray(pool?.ko) ? pool.ko[0] : ""),
        l: (ko: string[], en: string[], ja: string[], zh: string[]) => ({ ko, en, ja, zh }),
        resolveLang: () => "ko",
        getProjectReviewGateSnapshot: () => ({ activeReview: 1, activeTotal: 1, ready: true }),
        projectReviewGateNotifiedAt: new Map<string, number>(),
        notifyCeo,
        taskWorktrees: new Map<string, { worktreePath: string; projectPath: string; branchName: string }>(),
        mergeToDevAndCreatePR: vi.fn(() => ({ success: true, message: "pr created" })),
        mergeWorktree,
        cleanupWorktree: vi.fn(),
        findTeamLeader: vi.fn(() => null),
        getAgentDisplayName: vi.fn(() => "팀장"),
        setTaskCreationAuditCompletion: vi.fn(),
        endTaskExecutionSession: vi.fn(),
        notifyTaskStatus: vi.fn(),
        refreshCliUsageData: vi.fn(async () => ({})),
        shouldDeferTaskReportUntilPlanningArchive: vi.fn(() => false),
        emitTaskReportEvent: vi.fn(),
        formatTaskSubtaskProgressSummary: vi.fn(() => ""),
        reviewRoundState: new Map<string, number>(),
        reviewInFlight: new Set<string>(),
        archivePlanningConsolidatedReport: vi.fn(async () => undefined),
        crossDeptNextCallbacks: new Map<string, () => void>(),
        recoverCrossDeptQueueAfterMissingCallback: vi.fn(),
        subtaskDelegationCallbacks: new Map<string, () => void>(),
        startReviewConsensusMeeting,
      } as any);

      tools.finishReview(taskId, "Video intro", {
        bypassProjectDecisionGate: true,
        trigger: "test",
      });

      const updated = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string };
      expect(updated.status).toBe("review");
      expect(startReviewConsensusMeeting).not.toHaveBeenCalled();
      expect(mergeWorktree).not.toHaveBeenCalled();
      expect(appendTaskLog).toHaveBeenCalledWith(
        taskId,
        "system",
        expect.stringContaining("remotion evidence missing/invalid"),
      );
      expect(notifyCeo).toHaveBeenCalled();
    } finally {
      try {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      } catch {
        // best effort cleanup
      }
      try {
        fs.rmSync(logsDir, { recursive: true, force: true });
      } catch {
        // best effort cleanup
      }
      db.close();
    }
  });
});
