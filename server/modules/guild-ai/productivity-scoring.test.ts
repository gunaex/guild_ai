import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyBaseSchema } from "../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { scoreGuildProductivityForAllAgents } from "./productivity-scoring.ts";

function seed(db: DatabaseSync): number {
  const now = Date.UTC(2026, 5, 4, 8, 0, 0);
  applyBaseSchema(db);
  applyGuildAiSchema(db);
  db.prepare("INSERT INTO departments (id, name, name_ko, icon, color) VALUES (?, ?, ?, ?, ?)").run(
    "engineering",
    "Engineering",
    "Engineering",
    "code",
    "#10b981",
  );
  db.prepare(
    "INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json) VALUES (?, ?, ?, ?, ?)",
  ).run("ecom-001", "E-Commerce", "ecommerce", "USD", "{}");
  for (const role of ["worker", "qa"]) {
    db.prepare("INSERT INTO agents (id, name, department_id, role) VALUES (?, ?, ?, ?)").run(
      `runtime-${role}`,
      role,
      "engineering",
      role === "qa" ? "senior" : "junior",
    );
    db.prepare("INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model, productivity_floor) VALUES (?, ?, ?, ?, ?, ?)").run(
      "ecom-001",
      `${role}-001`,
      role,
      role,
      "llama3",
      role === "worker" ? 60 : 75,
    );
    db.prepare("INSERT INTO guild_runtime_bindings (guild_id, guild_agent_id, runtime_agent_id, api_provider_id, model) VALUES (?, ?, ?, ?, ?)").run(
      "ecom-001",
      `${role}-001`,
      `runtime-${role}`,
      "ollama",
      "llama3",
    );
  }
  db.prepare("INSERT INTO tasks (id, title, status, assigned_agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    "task-1",
    "Done work",
    "done",
    "runtime-worker",
    now - 1000,
    now - 500,
  );
  db.prepare("INSERT INTO task_logs (task_id, kind, message, created_at) VALUES (?, ?, ?, ?)").run(
    "task-1",
    "system",
    "qa_pass accepted",
    now - 400,
  );
  db.prepare("INSERT INTO tasks (id, title, status, assigned_agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    "task-2",
    "Cancelled QA",
    "cancelled",
    "runtime-qa",
    now - 1000,
    now - 500,
  );
  db.prepare("INSERT INTO task_logs (task_id, kind, message, created_at) VALUES (?, ?, ?, ?)").run(
    "task-2",
    "system",
    "revision requested rework",
    now - 400,
  );
  db.prepare("INSERT INTO guild_token_usage (guild_id, agent_id, provider, model, total_tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "ecom-001",
    "worker-001",
    "ollama",
    "llama3",
    1000,
    0.25,
    now - 100,
  );
  db.prepare("INSERT INTO guild_ai_limit_events (guild_id, agent_id, api_provider_id, provider, model, message, active_until) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "ecom-001",
    "qa-001",
    "ollama",
    "ollama",
    "llama3",
    "limited",
    now + 60_000,
  );
  return now;
}

describe("Guild AI productivity scoring", () => {
  it("scores agents from task, QA, token, and limit evidence", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const now = seed(db);
      const results = scoreGuildProductivityForAllAgents(db, { guildId: "ecom-001", generatedAt: now });
      const worker = results.find((item) => item.review.agent_id === "worker-001");
      const qa = results.find((item) => item.review.agent_id === "qa-001");

      expect(results).toHaveLength(2);
      expect(worker?.review.scoring_source).toBe("auto");
      expect(worker?.review.productivity_score).toBeGreaterThan(qa?.review.productivity_score ?? 100);
      expect(worker?.evidence.tasksDone).toBe(1);
      expect(worker?.evidence.qaPassSignals).toBe(1);
      expect(qa?.evidence.activeLimitEvents).toBe(1);
      expect(qa?.governanceRequest?.request_type).toBe("termination");
    } finally {
      db.close();
    }
  });
});
