import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyBaseSchema } from "../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { resolveGuildTaskSmokeRunTarget, stageGuildTaskSmoke } from "./task-smoke.ts";

function seedRuntimeBinding(db: DatabaseSync, now: number): void {
  applyBaseSchema(db);
  applyGuildAiSchema(db);
  db.prepare(
    "INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("ecom-001", "E-Commerce", "ecommerce", "USD", "{}", now, now);
  db.prepare("INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model) VALUES (?, ?, ?, ?, ?)").run(
    "ecom-001",
    "tech-001",
    "techLead",
    "Tech Lead",
    "local",
  );
  db.prepare("INSERT INTO departments (id, name, name_ko, icon, color) VALUES (?, ?, ?, ?, ?)").run(
    "dev",
    "Dev",
    "Dev",
    "D",
    "#000",
  );
  db.prepare("INSERT INTO agents (id, name, department_id, role, created_at) VALUES (?, ?, ?, ?, ?)").run(
    "aria",
    "Aria",
    "dev",
    "team_leader",
    now,
  );
  db.prepare(
    "INSERT INTO api_providers (id, name, type, base_url, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
  ).run("ollama-1", "Local Ollama", "ollama", "http://localhost:11434/v1", now, now);
  db.prepare(
    "INSERT INTO guild_runtime_bindings (guild_id, guild_agent_id, runtime_agent_id, api_provider_id, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
  ).run("ecom-001", "tech-001", "aria", "ollama-1", "llama3:latest", now, now);
}

describe("Guild AI task smoke", () => {
  it("stages a planned scratch task for an active runtime binding", () => {
    const db = new DatabaseSync(":memory:");
    const now = Date.UTC(2026, 0, 2);
    try {
      seedRuntimeBinding(db, now);
      const scratchRoot = path.join(os.tmpdir(), "guild-ai-task-smoke-test");

      const result = stageGuildTaskSmoke(db, {
        guildId: "ecom-001",
        roleKey: "techLead",
        scratchRoot,
        now,
      });

      expect(result).toMatchObject({
        guildId: "ecom-001",
        roleKey: "techLead",
        projectId: "guild-smoke-ecom-001",
        runtimeAgentId: "aria",
        runtimeAgentName: "Aria",
        status: "planned",
      });
      expect(result.projectPath).toBe(path.join(scratchRoot, "ecom-001"));

      const task = db.prepare("SELECT status, assigned_agent_id, project_id, project_path FROM tasks WHERE id = ?").get(
        result.taskId,
      ) as { status: string; assigned_agent_id: string; project_id: string; project_path: string };
      expect(task).toEqual({
        status: "planned",
        assigned_agent_id: "aria",
        project_id: "guild-smoke-ecom-001",
        project_path: result.projectPath,
      });
      expect(fs.existsSync(path.join(result.projectPath, "GUILD_SMOKE.md"))).toBe(true);
      expect(fs.readFileSync(path.join(result.projectPath, "GUILD_SMOKE.md"), "utf8")).toContain(
        "Guild AI Scratch Smoke",
      );
      expect(fs.existsSync(path.join(result.projectPath, "SMOKE_RESULT.md"))).toBe(true);
      expect(
        db
          .prepare("SELECT description FROM tasks WHERE id = ?")
          .get(result.taskId) as { description: string },
      ).toMatchObject({ description: expect.stringContaining("SMOKE_RESULT.md") });
    } finally {
      db.close();
    }
  });

  it("rejects scratch roots outside the temp directory", () => {
    const db = new DatabaseSync(":memory:");
    const now = Date.UTC(2026, 0, 2);
    try {
      seedRuntimeBinding(db, now);
      expect(() =>
        stageGuildTaskSmoke(db, {
          guildId: "ecom-001",
          roleKey: "techLead",
          scratchRoot: "/home/not-safe",
          now,
        }),
      ).toThrow("scratchRoot must be inside the system temp directory");
    } finally {
      db.close();
    }
  });

  it("stages task smoke on an available backup binding when the primary role binding is limited", () => {
    const db = new DatabaseSync(":memory:");
    const now = Date.UTC(2026, 0, 2);
    try {
      seedRuntimeBinding(db, now);
      db.prepare("INSERT INTO agents (id, name, department_id, role, created_at) VALUES (?, ?, ?, ?, ?)").run(
        "backup-aria",
        "Backup Aria",
        "dev",
        "team_leader",
        now,
      );
      db.prepare(
        "INSERT INTO api_providers (id, name, type, base_url, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
      ).run("ollama-2", "Local Ollama Backup", "ollama", "http://localhost:11434/v1", now, now);
      db.prepare(
        "INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model) VALUES (?, ?, ?, ?, ?)",
      ).run("ecom-001", "tech-002", "techLead", "Tech Lead Backup", "local");
      db.prepare(
        "INSERT INTO guild_runtime_bindings (guild_id, guild_agent_id, runtime_agent_id, api_provider_id, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
      ).run("ecom-001", "tech-002", "backup-aria", "ollama-2", "llama3:backup", now, now);
      db.prepare(
        `INSERT INTO guild_ai_limit_events (
          guild_id, agent_id, api_provider_id, provider, model, limit_type, message, active_until, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("ecom-001", "aria", "ollama-1", "ollama", "llama3:latest", "rate_limit", "cooldown", Date.now() + 60_000, now);

      const result = stageGuildTaskSmoke(db, {
        guildId: "ecom-001",
        roleKey: "techLead",
        scratchRoot: path.join(os.tmpdir(), "guild-ai-task-smoke-test"),
        now,
      });

      expect(result.runtimeAgentId).toBe("backup-aria");
      expect(result.runtimeAgentName).toBe("Backup Aria");
    } finally {
      db.close();
    }
  });

  it("resolves a staged smoke task as a safe run target", () => {
    const db = new DatabaseSync(":memory:");
    const now = Date.UTC(2026, 0, 2);
    try {
      seedRuntimeBinding(db, now);
      const staged = stageGuildTaskSmoke(db, {
        guildId: "ecom-001",
        roleKey: "techLead",
        scratchRoot: path.join(os.tmpdir(), "guild-ai-task-smoke-test"),
        now,
      });

      expect(resolveGuildTaskSmokeRunTarget(db, { guildId: "ecom-001", taskId: staged.taskId })).toMatchObject({
        taskId: staged.taskId,
        guildId: "ecom-001",
        roleKey: "techLead",
        runtimeAgentId: "aria",
        runtimeAgentName: "Aria",
        departmentId: "dev",
        projectPath: staged.projectPath,
      });
    } finally {
      db.close();
    }
  });

  it("rejects smoke run targets outside the temp directory", () => {
    const db = new DatabaseSync(":memory:");
    const now = Date.UTC(2026, 0, 2);
    try {
      seedRuntimeBinding(db, now);
      db.prepare(
        `INSERT INTO tasks (
          id, title, status, assigned_agent_id, workflow_meta_json, project_path, created_at, updated_at
        ) VALUES (?, ?, 'planned', ?, ?, ?, ?, ?)`,
      ).run(
        "unsafe-task",
        "Unsafe smoke",
        "aria",
        JSON.stringify({ guildId: "ecom-001", roleKey: "techLead", smoke: true }),
        "/home/not-safe",
        now,
        now,
      );

      expect(() => resolveGuildTaskSmokeRunTarget(db, { guildId: "ecom-001", taskId: "unsafe-task" })).toThrow(
        "project path is not inside the system temp directory",
      );
    } finally {
      db.close();
    }
  });

  it("rejects non-smoke tasks as smoke run targets", () => {
    const db = new DatabaseSync(":memory:");
    const now = Date.UTC(2026, 0, 2);
    try {
      seedRuntimeBinding(db, now);
      db.prepare(
        `INSERT INTO tasks (
          id, title, status, assigned_agent_id, workflow_meta_json, project_path, created_at, updated_at
        ) VALUES (?, ?, 'planned', ?, ?, ?, ?, ?)`,
      ).run(
        "regular-task",
        "Regular task",
        "aria",
        JSON.stringify({ guildId: "ecom-001", roleKey: "techLead" }),
        path.join(os.tmpdir(), "guild-ai-task-smoke-test", "regular"),
        now,
        now,
      );

      expect(() => resolveGuildTaskSmokeRunTarget(db, { guildId: "ecom-001", taskId: "regular-task" })).toThrow(
        "Task is not a Guild AI smoke task",
      );
    } finally {
      db.close();
    }
  });
});
