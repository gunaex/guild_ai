import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyBaseSchema } from "../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import {
  getLatestGuildCommunityInsight,
  listGuildCommunityParticipants,
  startGuildCommunityLoungeSession,
} from "./community-lounge.ts";

function seedGuild(db: DatabaseSync): void {
  applyBaseSchema(db);
  applyGuildAiSchema(db);
  db.prepare("INSERT INTO departments (id, name, name_ko, icon, color) VALUES (?, ?, ?, ?, ?)").run(
    "ops",
    "Operations",
    "Operations",
    "briefcase",
    "#0f766e",
  );
  db.prepare("INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json) VALUES (?, ?, ?, ?, ?)").run(
    "ecom-001",
    "E-Commerce",
    "ecommerce",
    "USD",
    "{}",
  );
  for (const [role, status] of [
    ["hr", "break"],
    ["pm", "idle"],
    ["qa", "idle"],
    ["worker", "working"],
  ] as const) {
    db.prepare("INSERT INTO agents (id, name, department_id, role, status) VALUES (?, ?, ?, ?, ?)").run(
      `runtime-${role}`,
      `Runtime ${role}`,
      "ops",
      "senior",
      status,
    );
    db.prepare("INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model) VALUES (?, ?, ?, ?, ?)").run(
      "ecom-001",
      `${role}-001`,
      role,
      `${role.toUpperCase()} Agent`,
      "llama3",
    );
    db.prepare("INSERT INTO guild_runtime_bindings (guild_id, guild_agent_id, runtime_agent_id, api_provider_id, model) VALUES (?, ?, ?, ?, ?)").run(
      "ecom-001",
      `${role}-001`,
      `runtime-${role}`,
      "ollama",
      "llama3",
    );
  }
}

describe("Guild AI community lounge", () => {
  it("turns break-time discussion into learning memory and SGM advice", () => {
    const db = new DatabaseSync(":memory:");
    try {
      seedGuild(db);
      const now = Date.UTC(2026, 5, 5, 8, 30, 0);

      expect(listGuildCommunityParticipants(db, "ecom-001").map((item) => item.roleKey)).toEqual(["hr", "pm", "qa"]);

      const detail = startGuildCommunityLoungeSession(db, {
        guildId: "ecom-001",
        topic: "How should the team use Library skills during breaks?",
        now,
      });

      expect(detail.session.status).toBe("completed");
      expect(detail.messages.length).toBeGreaterThanOrEqual(5);
      expect(detail.messages.some((message) => message.message_type === "recommendation")).toBe(true);

      const memory = db
        .prepare("SELECT namespace, content, metadata_json FROM guild_memory_records WHERE guild_id = ?")
        .get("ecom-001") as { namespace: string; content: string; metadata_json: string } | undefined;
      expect(memory?.namespace).toBe("learning");
      expect(memory?.content).toContain("Community Lounge discussed");
      expect(memory?.metadata_json).toContain(detail.session.id);

      const advice = db
        .prepare("SELECT category, title, status FROM guild_human_advice WHERE guild_id = ?")
        .get("ecom-001") as { category: string; title: string; status: string } | undefined;
      expect(advice).toMatchObject({
        category: "learning",
        title: "Community Lounge learning suggestion",
        status: "open",
      });

      expect(getLatestGuildCommunityInsight(db, "ecom-001", now + 1).sessions24h).toBe(1);
    } finally {
      db.close();
    }
  });

  it("skips safely when fewer than two participants are available", () => {
    const db = new DatabaseSync(":memory:");
    try {
      seedGuild(db);
      db.prepare("UPDATE agents SET status = 'working' WHERE id IN ('runtime-pm', 'runtime-qa')").run();

      const detail = startGuildCommunityLoungeSession(db, {
        guildId: "ecom-001",
        topic: "Too quiet",
        now: Date.UTC(2026, 5, 5, 9, 0, 0),
      });

      expect(detail.session.status).toBe("skipped");
      expect(detail.messages).toHaveLength(0);
      expect(db.prepare("SELECT COUNT(*) AS count FROM guild_memory_records").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });
});
