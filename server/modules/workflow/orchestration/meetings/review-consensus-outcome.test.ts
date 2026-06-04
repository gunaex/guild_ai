import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { processReviewConsensusOutcome } from "./review-consensus-outcome.ts";

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      assigned_agent_id TEXT,
      workflow_meta_json TEXT,
      project_path TEXT,
      updated_at INTEGER DEFAULT 0
    );

    CREATE TABLE task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER
    );

    CREATE TABLE meeting_minutes (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      meeting_type TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE api_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
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

describe("review consensus outcome Guild AI routing", () => {
  it("routes Guild AI QA hold to Worker retry", async () => {
    const db = createDb();
    try {
      db.prepare(
        "INSERT INTO tasks (id, title, status, assigned_agent_id, workflow_meta_json, updated_at) VALUES (?, ?, 'review', ?, ?, 1)",
      ).run("task-1", "QA review", "qa-runtime", JSON.stringify({ guildId: "ecom-001", currentGuildRole: "qa" }));
      db.prepare("INSERT INTO agents (id, name) VALUES (?, ?)").run("worker-runtime", "Worker");
      db.prepare("INSERT INTO api_providers (id, name) VALUES (?, ?)").run("provider-1", "Local Ollama");
      db.prepare(
        "INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model) VALUES (?, ?, ?, ?, ?)",
      ).run("ecom-001", "worker-001", "worker", "Worker", "llama3");
      db.prepare(
        "INSERT INTO guild_runtime_bindings (guild_id, guild_agent_id, runtime_agent_id, api_provider_id, model, status, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?)",
      ).run("ecom-001", "worker-001", "worker-runtime", "provider-1", "llama3", 1);

      const appendTaskLog = vi.fn();
      const result = await processReviewConsensusOutcome({
        taskId: "task-1",
        taskTitle: "QA review",
        round: 1,
        roundMode: "round1",
        isRound1Remediation: true,
        isRound2Merge: false,
        isFinalDecisionRound: false,
        leaders: [{ id: "qa-lead", department_id: "qa", name: "QA Lead" }],
        transcript: [{ agentId: "qa-lead", content: "Hold approval. Needs revision." }],
        lang: "en",
        workflowPackKey: "development",
        meetingId: "meeting-1",
        onApproved: vi.fn(),
        abortIfInactive: () => false,
        meetingReviewDecisionByAgent: new Map([["qa-lead", "hold"]]),
        findLatestTranscriptContentByAgent: () => "Hold approval. Needs revision.",
        isDeferrableReviewHold: () => false,
        summarizeForMeetingBubble: (text: string) => text,
        getDeptName: () => "QA",
        getAgentDisplayName: () => "QA Lead",
        appendTaskLog,
        REVIEW_MAX_REVISION_SIGNALS_PER_ROUND: 8,
        REVIEW_MAX_REVISION_SIGNALS_PER_DEPT_PER_ROUND: 2,
        appendTaskProjectMemo: vi.fn(),
        sleepMs: async () => undefined,
        randomDelay: () => 0,
        collectRevisionMemoItems: vi.fn(() => ["Needs revision."]),
        REVIEW_MAX_MEMO_ITEMS_PER_ROUND: 8,
        REVIEW_MAX_MEMO_ITEMS_PER_DEPT: 2,
        reserveReviewRevisionMemoItems: vi.fn(() => ({ freshItems: ["Needs revision."], duplicateCount: 0 })),
        loadRecentReviewRevisionMemoItems: vi.fn(() => []),
        pickL: (pool: any) => (Array.isArray(pool?.en) ? pool.en[0] : ""),
        l: (ko: string[], en: string[], ja: string[], zh: string[]) => ({ ko, en, ja, zh }),
        db,
        REVIEW_MAX_REMEDIATION_REQUESTS: 1,
        notifyCeo: vi.fn(),
        finishMeetingMinutes: vi.fn(),
        dismissLeadersFromCeoOffice: vi.fn(),
        reviewRoundState: new Map<string, number>(),
        reviewInFlight: new Set<string>(),
        appendTaskReviewFinalMemo: vi.fn(),
        scheduleNextReviewRound: vi.fn(),
      });

      expect(result).toBe(true);
      const updated = db
        .prepare("SELECT status, assigned_agent_id, workflow_meta_json FROM tasks WHERE id = ?")
        .get("task-1") as { status: string; assigned_agent_id: string; workflow_meta_json: string };
      expect(updated.status).toBe("planned");
      expect(updated.assigned_agent_id).toBe("worker-runtime");
      expect(JSON.parse(updated.workflow_meta_json)).toMatchObject({
        routeDecision: "qa_fail",
        currentGuildRole: "worker",
        retryCount: 1,
      });
      expect(appendTaskLog).toHaveBeenCalledWith(
        "task-1",
        "system",
        expect.stringContaining("Guild AI review route: qa_fail"),
      );
    } finally {
      db.close();
    }
  });
});
