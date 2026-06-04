import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyBaseSchema } from "../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { buildGuildAuditReplay } from "./audit-replay.ts";
import { recordGuildMemory } from "./memory.ts";

describe("Guild AI audit replay", () => {
  it("combines task, journal, memory, and HR evidence into one timeline", () => {
    const db = new DatabaseSync(":memory:");
    try {
      applyBaseSchema(db);
      applyGuildAiSchema(db);
      db.prepare(
        "INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json) VALUES (?, ?, ?, ?, ?)",
      ).run("ecom-001", "E-Commerce", "ecommerce", "USD", "{}");
      db.prepare("INSERT INTO tasks (id, title, status, workflow_meta_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        "task-1",
        "Smoke",
        "done",
        JSON.stringify({ guildId: "ecom-001" }),
        100,
        200,
      );
      db.prepare("INSERT INTO task_logs (task_id, kind, message, created_at) VALUES (?, ?, ?, ?)").run(
        "task-1",
        "system",
        "Guild ecom-001 qa_pass",
        210,
      );
      db.prepare(
        "INSERT INTO guild_accounting_journal_entries (id, guild_id, entry_date, description, source_type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("j-1", "ecom-001", "2026-06-04", "Token usage", "token_usage", 220);
      db.prepare(
        "INSERT INTO guild_hr_reviews (guild_id, agent_id, productivity_score, review_date, scoring_source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("ecom-001", "worker-001", 88, "2026-06-04", "auto", 230);
      recordGuildMemory(db, { guildId: "ecom-001", namespace: "operations", content: "Audit note", createdAt: 240 });

      const replay = buildGuildAuditReplay(db, { guildId: "ecom-001", generatedAt: 300, since: 1 });

      expect(replay.events.map((event) => event.source)).toContain("task");
      expect(replay.events.map((event) => event.source)).toContain("task_log");
      expect(replay.events.map((event) => event.source)).toContain("journal");
      expect(replay.events.map((event) => event.source)).toContain("hr");
      expect(replay.events.map((event) => event.source)).toContain("memory");
    } finally {
      db.close();
    }
  });
});
