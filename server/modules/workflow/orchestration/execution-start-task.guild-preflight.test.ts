import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { applyBaseSchema } from "../../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../../bootstrap/schema/guild-ai-schema.ts";
import { createExecutionStartTaskTools } from "./execution-start-task.ts";

function seedGuildRuntime(db: DatabaseSync, input: { backupAvailable: boolean }) {
  const now = Date.UTC(2026, 0, 1);
  db.prepare("INSERT INTO departments (id, name, name_ko, icon, color) VALUES (?, ?, ?, ?, ?)").run(
    "dev",
    "Dev",
    "Dev",
    "D",
    "#000",
  );
  db.prepare(
    "INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("ecom-001", "E-Commerce Guild", "ecommerce", "USD", "{}", now, now);
  db.prepare(
    "INSERT INTO api_providers (id, name, type, base_url, enabled, created_at, updated_at) VALUES (?, ?, 'openai', ?, 1, ?, ?)",
  ).run("provider-1", "Primary", "https://primary.test/v1", now, now);
  db.prepare(
    "INSERT INTO api_providers (id, name, type, base_url, enabled, created_at, updated_at) VALUES (?, ?, 'openai', ?, 1, ?, ?)",
  ).run("provider-2", "Backup", "https://backup.test/v1", now, now);
  db.prepare(
    "INSERT INTO agents (id, name, department_id, role, cli_provider, api_provider_id, api_model, created_at) VALUES (?, ?, ?, ?, 'api', ?, ?, ?)",
  ).run("primary-worker", "Primary Worker", "dev", "senior", "provider-1", "gpt-primary", now);
  db.prepare(
    "INSERT INTO agents (id, name, department_id, role, cli_provider, api_provider_id, api_model, created_at) VALUES (?, ?, ?, ?, 'api', ?, ?, ?)",
  ).run("backup-worker", "Backup Worker", "dev", "senior", "provider-2", "gpt-backup", now);
  db.prepare(
    "INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model) VALUES (?, ?, 'worker', ?, ?)",
  ).run("ecom-001", "worker-primary", "Worker Primary", "gpt-primary");
  db.prepare(
    "INSERT INTO guild_runtime_bindings (guild_id, guild_agent_id, runtime_agent_id, api_provider_id, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
  ).run("ecom-001", "worker-primary", "primary-worker", "provider-1", "gpt-primary", now, now + 2);

  if (input.backupAvailable) {
    db.prepare(
      "INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model) VALUES (?, ?, 'worker', ?, ?)",
    ).run("ecom-001", "worker-backup", "Worker Backup", "gpt-backup");
    db.prepare(
      "INSERT INTO guild_runtime_bindings (guild_id, guild_agent_id, runtime_agent_id, api_provider_id, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
    ).run("ecom-001", "worker-backup", "backup-worker", "provider-2", "gpt-backup", now, now + 1);
  }

  db.prepare(
    `INSERT INTO guild_ai_limit_events (
      guild_id, agent_id, api_provider_id, provider, model, limit_type, message, active_until, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("ecom-001", "primary-worker", "provider-1", "openai", "gpt-primary", "rate_limit", "cooldown", Date.now() + 60_000, now);

  db.prepare(
    `INSERT INTO tasks (
      id, title, description, department_id, assigned_agent_id, status, workflow_meta_json, project_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  ).run(
    "task-1",
    "Guild worker task",
    "Run the worker step",
    "dev",
    "primary-worker",
    JSON.stringify({ guildId: "ecom-001", currentGuildRole: "worker" }),
    "/tmp/project",
    now,
    now,
  );

  return db.prepare("SELECT * FROM agents WHERE id = 'primary-worker'").get();
}

function createHarness(db: DatabaseSync) {
  const launchApiProviderAgent = vi.fn();
  const createWorktree = vi.fn(() => "/tmp/guild-worktree");
  const appendTaskLog = vi.fn();
  const broadcast = vi.fn();
  const tools = createExecutionStartTaskTools({
    nowMs: () => Date.UTC(2026, 0, 1, 1),
    db: db as any,
    logsDir: "/tmp",
    appendTaskLog,
    broadcast,
    ensureTaskExecutionSession: (taskId: string, agentId: string, provider: string) => ({
      sessionId: `session-${taskId}-${agentId}`,
      agentId,
      provider,
    }),
    resolveLang: () => "en",
    notifyTaskStatus: vi.fn(),
    resolveProjectPath: (task: any) => task.project_path,
    createWorktree,
    getDeptRoleConstraint: () => "",
    getRecentConversationContext: () => "",
    getTaskContinuationContext: () => "",
    getRecentChanges: () => "",
    ensureClaudeMd: vi.fn(),
    pickL: (value: any) => (Array.isArray(value) ? value[0] : value),
    l: (_ko: any, en: any) => en,
    buildAvailableSkillsPromptBlock: () => "",
    buildTaskExecutionPrompt: (parts: string[]) => parts.filter(Boolean).join("\n"),
    hasExplicitWarningFixRequest: () => false,
    getNextHttpAgentPid: () => 1001,
    launchApiProviderAgent,
    launchHttpAgent: vi.fn(),
    getProviderModelConfig: () => ({}),
    spawnCliAgent: vi.fn(),
    handleTaskRunComplete: vi.fn(),
    notifyCeo: vi.fn(),
    startProgressTimer: vi.fn(),
  } as any);
  return { tools, launchApiProviderAgent, createWorktree, appendTaskLog, broadcast };
}

describe("Guild AI execution preflight", () => {
  it("switches to an available same-role runtime before launching an API task", () => {
    const db = new DatabaseSync(":memory:");
    try {
      applyBaseSchema(db);
      applyGuildAiSchema(db);
      const primaryAgent = seedGuildRuntime(db, { backupAvailable: true });
      const harness = createHarness(db);

      harness.tools.startTaskExecutionForAgent("task-1", primaryAgent, "dev", "Dev");

      const task = db.prepare("SELECT status, assigned_agent_id FROM tasks WHERE id = 'task-1'").get() as {
        status: string;
        assigned_agent_id: string;
      };
      expect(task).toEqual({ status: "in_progress", assigned_agent_id: "backup-worker" });
      expect(harness.launchApiProviderAgent).toHaveBeenCalledWith(
        "task-1",
        "provider-2",
        "gpt-backup",
        expect.any(String),
        "/tmp/guild-worktree",
        "/tmp/task-1.log",
        expect.any(AbortController),
        1001,
      );
      expect(harness.appendTaskLog).toHaveBeenCalledWith(
        "task-1",
        "system",
        expect.stringContaining("preflight switched from Primary Worker to Backup Worker"),
      );
    } finally {
      db.close();
    }
  });

  it("keeps the task pending when every active same-role runtime is limited", () => {
    const db = new DatabaseSync(":memory:");
    try {
      applyBaseSchema(db);
      applyGuildAiSchema(db);
      const primaryAgent = seedGuildRuntime(db, { backupAvailable: false });
      const harness = createHarness(db);

      harness.tools.startTaskExecutionForAgent("task-1", primaryAgent, "dev", "Dev");

      const task = db.prepare("SELECT status, assigned_agent_id, started_at FROM tasks WHERE id = 'task-1'").get() as {
        status: string;
        assigned_agent_id: string;
        started_at: number | null;
      };
      expect(task).toEqual({ status: "pending", assigned_agent_id: "primary-worker", started_at: null });
      expect(harness.createWorktree).not.toHaveBeenCalled();
      expect(harness.launchApiProviderAgent).not.toHaveBeenCalled();
      expect(harness.appendTaskLog).toHaveBeenCalledWith(
        "task-1",
        "system",
        "Guild AI execution blocked: all active 'worker' runtimes are limited.",
      );
    } finally {
      db.close();
    }
  });
});
