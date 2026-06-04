import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyBaseSchema } from "../../../bootstrap/schema/base-schema.ts";
import { applyTaskSchemaMigrations } from "../../../bootstrap/schema/task-schema-migrations.ts";
import { applyGuildAiSchema } from "../../../bootstrap/schema/guild-ai-schema.ts";
import { recordAiCreditTopupWithJournal } from "../../../guild-ai/accounting-journal.ts";
import { createApiProviderTools } from "./api-provider-tools.ts";
import { createStreamTools } from "./stream-tools.ts";

function makeSseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join("\n")));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

function createHarness() {
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  applyTaskSchemaMigrations(db);
  applyGuildAiSchema(db);

  db.prepare(
    `INSERT INTO departments (id, name, name_ko, icon, color, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("dev", "Development", "Development", "code", "#22c55e", 1);
  db.prepare(
    `INSERT INTO api_providers (id, name, type, base_url, enabled, models_cache, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run("provider-1", "OpenAI Test", "openai", "https://example.test/v1", JSON.stringify(["gpt-test"]), 1, 1);
  db.prepare(
    `INSERT INTO api_providers (id, name, type, base_url, enabled, models_cache, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run("provider-2", "OpenAI Backup", "openai", "https://backup.test/v1", JSON.stringify(["gpt-backup"]), 1, 1);
  db.prepare(
    `INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("ecom-001", "E-Commerce Guild", "ecommerce", "USD", "{}", 1, 1);
  db.prepare(
    `INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("ecom-001", "agent-1", "worker", "Worker", "gpt-test", 1);
  db.prepare(
    `INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("ecom-001", "guild-worker-backup", "worker", "Backup Worker", "gpt-backup", 1);
  db.prepare(
    `INSERT INTO agents (id, name, department_id, role, cli_provider, api_provider_id, api_model, status, created_at)
     VALUES (?, ?, ?, ?, 'api', ?, ?, 'idle', ?)`,
  ).run("agent-1", "Primary Worker", "dev", "senior", "provider-1", "gpt-test", 1);
  db.prepare(
    `INSERT INTO agents (id, name, department_id, role, cli_provider, api_provider_id, api_model, status, created_at)
     VALUES (?, ?, ?, ?, 'api', ?, ?, 'idle', ?)`,
  ).run("agent-2", "Backup Worker", "dev", "senior", "provider-2", "gpt-backup", 1);
  db.prepare(
    `INSERT INTO guild_runtime_bindings (
      guild_id, guild_agent_id, runtime_agent_id, api_provider_id, model, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run("ecom-001", "guild-worker-backup", "agent-2", "provider-2", "gpt-backup", 1, 2);

  const streamTools = createStreamTools({
    db,
    broadcast: () => undefined,
    normalizeStreamChunk: (raw) => String(raw),
    createSubtaskFromCli: () => undefined,
    completeSubtaskFromCli: () => undefined,
  });
  const apiTools = createApiProviderTools({
    db,
    logsDir: "/tmp",
    activeProcesses: new Map(),
    broadcast: () => undefined,
    normalizeStreamChunk: (raw) => String(raw),
    handleTaskRunComplete: () => undefined,
    createSafeLogStreamOps: () => ({
      safeWrite: () => true,
      safeEnd: (onDone) => onDone?.(),
      isClosed: () => false,
    }),
    parseSSEStream: streamTools.parseSSEStream,
    parseGeminiSSEStream: streamTools.parseGeminiSSEStream,
  });

  return { db, apiTools };
}

describe("api provider tools Guild AI accounting", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("records provider usage against prepaid AI credits when the guild has enough balance", async () => {
    const { db, apiTools } = createHarness();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        makeSseResponse([
          'data: {"choices":[{"delta":{"content":"ok"}}]}',
          'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17,"response_cost":0.5}}',
          "data: [DONE]",
        ]),
      ),
    );

    try {
      recordAiCreditTopupWithJournal(db, {
        guildId: "ecom-001",
        provider: "openai",
        description: "AI provider credit top-up",
        amountUsd: 2,
        paidFrom: "cash",
        createdAt: 1,
      });

      await apiTools.executeApiProviderAgent(
        "hello",
        "/tmp",
        {} as any,
        new AbortController().signal,
        undefined,
        "provider-1",
        "gpt-test",
        () => true,
        "agent-1",
      );

      const tokenEntry = db
        .prepare("SELECT id FROM guild_accounting_journal_entries WHERE source_type = 'token_usage' LIMIT 1")
        .get() as { id: string };
      const creditLine = db
        .prepare(
          `SELECT account_code, debit, credit
           FROM guild_accounting_journal_lines
           WHERE entry_id = ? AND credit > 0`,
        )
        .get(tokenEntry.id);

      expect(creditLine).toEqual({ account_code: "1100", debit: 0, credit: 0.5 });
    } finally {
      db.close();
    }
  });

  it("falls back to accounts payable when prepaid AI credits are insufficient", async () => {
    const { db, apiTools } = createHarness();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        makeSseResponse([
          'data: {"choices":[{"delta":{"content":"ok"}}]}',
          'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17,"response_cost":0.5}}',
          "data: [DONE]",
        ]),
      ),
    );

    try {
      await apiTools.executeApiProviderAgent(
        "hello",
        "/tmp",
        {} as any,
        new AbortController().signal,
        undefined,
        "provider-1",
        "gpt-test",
        () => true,
        "agent-1",
      );

      const tokenEntry = db
        .prepare("SELECT id FROM guild_accounting_journal_entries WHERE source_type = 'token_usage' LIMIT 1")
        .get() as { id: string };
      const creditLine = db
        .prepare(
          `SELECT account_code, debit, credit
           FROM guild_accounting_journal_lines
           WHERE entry_id = ? AND credit > 0`,
        )
        .get(tokenEntry.id);

      expect(creditLine).toEqual({ account_code: "2000", debit: 0, credit: 0.5 });
    } finally {
      db.close();
    }
  });

  it("records a model limit event when the provider returns rate limit", async () => {
    const { db, apiTools } = createHarness();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limit exceeded", { status: 429, headers: { "retry-after": "60" } })),
    );

    try {
      await expect(
        apiTools.executeApiProviderAgent(
          "hello",
          "/tmp",
          {} as any,
          new AbortController().signal,
          "task-1",
          "provider-1",
          "gpt-test",
          () => true,
          "agent-1",
        ),
      ).rejects.toThrow("rate limit exceeded");

      const event = db.prepare("SELECT * FROM guild_ai_limit_events WHERE api_provider_id = ?").get("provider-1") as {
        guild_id: string;
        agent_id: string;
        model: string;
        limit_type: string;
        status_code: number;
        retry_after_ms: number;
        source_id: string;
      };
      expect(event).toMatchObject({
        guild_id: "ecom-001",
        agent_id: "agent-1",
        model: "gpt-test",
        limit_type: "rate_limit",
        status_code: 429,
        retry_after_ms: 60000,
        source_id: "task-1",
      });
    } finally {
      db.close();
    }
  });

  it("stops only the active limited provider/model before retrying the network call", async () => {
    const { db, apiTools } = createHarness();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    db.prepare(
      `INSERT INTO guild_ai_limit_events (
        guild_id, agent_id, api_provider_id, provider, model, limit_type, message, active_until, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("ecom-001", "agent-1", "provider-1", "openai", "gpt-test", "rate_limit", "cooldown", Date.now() + 60_000, 1);
    db.prepare(
      `INSERT INTO guild_ai_limit_events (
        guild_id, agent_id, api_provider_id, provider, model, limit_type, message, active_until, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("ecom-001", "agent-2", "provider-2", "openai", "gpt-backup", "rate_limit", "backup cooldown", Date.now() + 60_000, 1);

    try {
      await expect(
        apiTools.executeApiProviderAgent(
          "hello",
          "/tmp",
          {} as any,
          new AbortController().signal,
          "task-1",
          "provider-1",
          "gpt-test",
          () => true,
          "agent-1",
        ),
      ).rejects.toThrow("AI model limit active");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("automatically resumes a provider/model after the limit window expires", async () => {
    const { db, apiTools } = createHarness();
    const fetchMock = vi.fn(async () =>
      makeSseResponse([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
        "data: [DONE]",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    db.prepare(
      `INSERT INTO guild_ai_limit_events (
        guild_id, agent_id, api_provider_id, provider, model, limit_type, message, active_until, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("ecom-001", "agent-1", "provider-1", "openai", "gpt-test", "rate_limit", "cooldown", Date.now() - 1_000, 1);

    try {
      await apiTools.executeApiProviderAgent(
        "hello",
        "/tmp",
        {} as any,
        new AbortController().signal,
        "task-1",
        "provider-1",
        "gpt-test",
        () => true,
        "agent-1",
      );

      const event = db.prepare("SELECT recovered_at FROM guild_ai_limit_events WHERE api_provider_id = ?").get(
        "provider-1",
      ) as { recovered_at: number | null };
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(event.recovered_at).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("falls back to an available same-role runtime binding when the selected model is still limited", async () => {
    const { db, apiTools } = createHarness();
    const fetchMock = vi.fn(async () =>
      makeSseResponse([
        'data: {"choices":[{"delta":{"content":"backup ok"}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}',
        "data: [DONE]",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    db.prepare(
      `INSERT INTO tasks (id, title, status, assigned_agent_id, created_at, updated_at)
       VALUES (?, ?, 'in_progress', ?, ?, ?)`,
    ).run("task-1", "Fallback task", "agent-1", 1, 1);
    db.prepare(
      `INSERT INTO guild_ai_limit_events (
        guild_id, agent_id, api_provider_id, provider, model, limit_type, message, active_until, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("ecom-001", "agent-1", "provider-1", "openai", "gpt-test", "rate_limit", "cooldown", Date.now() + 60_000, 1);

    try {
      await apiTools.executeApiProviderAgent(
        "hello",
        "/tmp",
        {} as any,
        new AbortController().signal,
        "task-1",
        "provider-1",
        "gpt-test",
        () => true,
        "agent-1",
      );

      const task = db.prepare("SELECT assigned_agent_id FROM tasks WHERE id = ?").get("task-1") as {
        assigned_agent_id: string;
      };
      const log = db.prepare("SELECT message FROM task_logs WHERE task_id = ? ORDER BY id DESC LIMIT 1").get("task-1") as {
        message: string;
      };
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("https://backup.test");
      expect(task.assigned_agent_id).toBe("agent-2");
      expect(log.message).toContain("AI limit fallback");
    } finally {
      db.close();
    }
  });
});
