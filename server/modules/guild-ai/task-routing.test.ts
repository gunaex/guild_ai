import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyBaseSchema } from "../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { applyGuildTaskRouteDecision } from "./task-routing.ts";

function seedRoutingHarness(db: DatabaseSync, now: number): void {
  applyBaseSchema(db);
  applyGuildAiSchema(db);
  db.prepare(
    "INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("ecom-001", "E-Commerce", "ecommerce", "USD", "{}", now, now);
  db.prepare("INSERT INTO departments (id, name, name_ko, icon, color) VALUES (?, ?, ?, ?, ?)").run(
    "dev",
    "Dev",
    "Dev",
    "D",
    "#000",
  );
  db.prepare("INSERT INTO departments (id, name, name_ko, icon, color) VALUES (?, ?, ?, ?, ?)").run(
    "qa",
    "QA",
    "QA",
    "Q",
    "#111",
  );
  db.prepare("INSERT INTO departments (id, name, name_ko, icon, color) VALUES (?, ?, ?, ?, ?)").run(
    "planning",
    "Planning",
    "Planning",
    "P",
    "#222",
  );

  const insertAgent = db.prepare(
    "INSERT INTO agents (id, name, department_id, role, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  insertAgent.run("worker-runtime", "Worker", "dev", "senior", now);
  insertAgent.run("qa-runtime", "QA", "qa", "senior", now);
  insertAgent.run("tech-runtime", "Tech Lead", "dev", "team_leader", now);
  insertAgent.run("pm-runtime", "PM", "planning", "team_leader", now);

  db.prepare(
    "INSERT INTO api_providers (id, name, type, base_url, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
  ).run("ollama-1", "Local Ollama", "ollama", "http://localhost:11434/v1", now, now);

  const insertRole = db.prepare(
    "INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  insertRole.run("ecom-001", "worker-001", "worker", "Worker", "local", now);
  insertRole.run("ecom-001", "qa-001", "qa", "QA", "local", now);
  insertRole.run("ecom-001", "tech-001", "techLead", "Tech Lead", "local", now);
  insertRole.run("ecom-001", "pm-001", "pm", "PM", "local", now);

  const insertBinding = db.prepare(
    "INSERT INTO guild_runtime_bindings (guild_id, guild_agent_id, runtime_agent_id, api_provider_id, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
  );
  insertBinding.run("ecom-001", "worker-001", "worker-runtime", "ollama-1", "llama3", now, now);
  insertBinding.run("ecom-001", "qa-001", "qa-runtime", "ollama-1", "llama3", now, now);
  insertBinding.run("ecom-001", "tech-001", "tech-runtime", "ollama-1", "llama3", now, now);
  insertBinding.run("ecom-001", "pm-001", "pm-runtime", "ollama-1", "llama3", now, now);

  db.prepare(
    `INSERT INTO tasks (
      id, title, department_id, assigned_agent_id, status, workflow_meta_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("task-1", "Create product copy", "dev", "worker-runtime", "in_progress", JSON.stringify({ guildId: "ecom-001" }), now, now);
}

describe("Guild AI task routing", () => {
  it("routes worker completion to QA review", () => {
    const db = new DatabaseSync(":memory:");
    try {
      seedRoutingHarness(db, 1);

      const result = applyGuildTaskRouteDecision(db, {
        guildId: "ecom-001",
        taskId: "task-1",
        decision: "worker_done",
        now: 2,
      });

      expect(result).toMatchObject({
        status: "review",
        assignedAgentId: "qa-runtime",
        assignedRole: "qa",
        retryCount: 0,
      });
    } finally {
      db.close();
    }
  });

  it("routes to an available backup binding when the first target role binding is limited", () => {
    const db = new DatabaseSync(":memory:");
    try {
      seedRoutingHarness(db, 1);
      db.prepare("INSERT INTO agents (id, name, department_id, role, created_at) VALUES (?, ?, ?, ?, ?)").run(
        "qa-backup-runtime",
        "QA Backup",
        "qa",
        "senior",
        1,
      );
      db.prepare(
        "INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("ecom-001", "qa-002", "qa", "QA Backup", "local", 1);
      db.prepare(
        "INSERT INTO guild_runtime_bindings (guild_id, guild_agent_id, runtime_agent_id, api_provider_id, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
      ).run("ecom-001", "qa-002", "qa-backup-runtime", "ollama-1", "llama3-backup", 1, 1);
      db.prepare(
        `INSERT INTO guild_ai_limit_events (
          guild_id, agent_id, api_provider_id, provider, model, limit_type, message, active_until, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("ecom-001", "qa-runtime", "ollama-1", "ollama", "llama3", "rate_limit", "cooldown", Date.now() + 60_000, 1);

      const result = applyGuildTaskRouteDecision(db, {
        guildId: "ecom-001",
        taskId: "task-1",
        decision: "worker_done",
        now: 2,
      });

      expect(result).toMatchObject({
        status: "review",
        assignedAgentId: "qa-backup-runtime",
        assignedRole: "qa",
      });
    } finally {
      db.close();
    }
  });

  it("routes QA failure back to the worker until retry budget is exhausted", () => {
    const db = new DatabaseSync(":memory:");
    try {
      seedRoutingHarness(db, 1);

      const retry = applyGuildTaskRouteDecision(db, {
        guildId: "ecom-001",
        taskId: "task-1",
        decision: "qa_fail",
        feedback: "Needs stronger CTA.",
        maxRetries: 1,
        now: 2,
      });
      expect(retry).toMatchObject({
        status: "planned",
        assignedAgentId: "worker-runtime",
        assignedRole: "worker",
        retryCount: 1,
        escalationLevel: null,
      });

      const escalation = applyGuildTaskRouteDecision(db, {
        guildId: "ecom-001",
        taskId: "task-1",
        decision: "qa_fail",
        feedback: "Still below quality threshold.",
        maxRetries: 1,
        now: 3,
      });
      expect(escalation).toMatchObject({
        status: "planned",
        assignedAgentId: "tech-runtime",
        assignedRole: "techLead",
        retryCount: 1,
        escalationLevel: "techLead",
      });
    } finally {
      db.close();
    }
  });

  it("can escalate from Tech Lead to PM and can close a QA pass", () => {
    const db = new DatabaseSync(":memory:");
    try {
      seedRoutingHarness(db, 1);

      const pm = applyGuildTaskRouteDecision(db, {
        guildId: "ecom-001",
        taskId: "task-1",
        decision: "techlead_escalate",
        now: 2,
      });
      expect(pm).toMatchObject({
        status: "planned",
        assignedAgentId: "pm-runtime",
        assignedRole: "pm",
        escalationLevel: "pm",
      });

      const done = applyGuildTaskRouteDecision(db, {
        guildId: "ecom-001",
        taskId: "task-1",
        decision: "qa_pass",
        now: 3,
      });
      expect(done).toMatchObject({
        status: "done",
        assignedAgentId: null,
        assignedRole: null,
      });
    } finally {
      db.close();
    }
  });

  it("requires completed smoke evidence before a smoke QA pass can close the task", () => {
    const db = new DatabaseSync(":memory:");
    const now = Date.UTC(2026, 0, 2);
    const projectPath = path.join(os.tmpdir(), "guild-ai-routing-smoke-test");
    try {
      seedRoutingHarness(db, now);
      fs.mkdirSync(projectPath, { recursive: true });
      fs.writeFileSync(path.join(projectPath, "SMOKE_RESULT.md"), "# Smoke Result\n\nPending agent execution.\n", "utf8");
      db.prepare("UPDATE tasks SET status = 'review', workflow_meta_json = ?, project_path = ? WHERE id = ?").run(
        JSON.stringify({ guildId: "ecom-001", roleKey: "worker", smoke: true, currentGuildRole: "qa" }),
        projectPath,
        "task-1",
      );

      expect(() =>
        applyGuildTaskRouteDecision(db, {
          guildId: "ecom-001",
          taskId: "task-1",
          decision: "qa_pass",
          now: now + 1,
        }),
      ).toThrow("completed SMOKE_RESULT.md");

      fs.writeFileSync(path.join(projectPath, "SMOKE_RESULT.md"), "# Smoke Result\n\nStatus: completed\n", "utf8");
      const done = applyGuildTaskRouteDecision(db, {
        guildId: "ecom-001",
        taskId: "task-1",
        decision: "qa_pass",
        now: now + 2,
      });

      expect(done).toMatchObject({
        status: "done",
        assignedAgentId: null,
        assignedRole: null,
      });
    } finally {
      db.close();
    }
  });
});
