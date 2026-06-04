import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyBaseSchema } from "../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { buildGuildSgmBriefing } from "./briefing.ts";

function seedBriefingData(db: DatabaseSync, now: number): void {
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
  db.prepare(
    "INSERT INTO guild_upgrade_proposals (id, guild_id, capability_area, target_level, title, rationale, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("proposal-1", "ecom-001", "runtime", 2, "Approve safer task smoke", "Need SGM approval", now, now);
}

describe("Guild AI SGM briefing", () => {
  it("summarizes SGM decisions and next actions from live guild state", () => {
    const db = new DatabaseSync(":memory:");
    const now = Date.UTC(2026, 0, 2);
    try {
      seedBriefingData(db, now);

      const briefing = buildGuildSgmBriefing(db, "ecom-001", now);

      expect(briefing.status).toBe("needs_decision");
      expect(briefing.headline).toContain("SGM decisions");
      expect(briefing.metrics).toMatchObject({ actors: 1, pendingUpgrades: 1, runtimeAvailable: 1, runtimeLimited: 0 });
      expect(briefing.bullets.some((bullet) => bullet.includes("Runtime readiness: 1 available"))).toBe(true);
      expect(briefing.bullets.some((bullet) => bullet.includes("Approve safer task smoke"))).toBe(true);
      expect(briefing.nextActions).toContainEqual({
        key: "review_upgrades",
        label: "Review pending upgrade proposals",
        priority: "high",
      });
    } finally {
      db.close();
    }
  });

  it("flags blocked runtime roles when every binding for a role is limited", () => {
    const db = new DatabaseSync(":memory:");
    const now = Date.UTC(2026, 0, 2);
    try {
      seedBriefingData(db, now);
      db.prepare(
        `INSERT INTO guild_ai_limit_events (
          guild_id, agent_id, api_provider_id, provider, model, limit_type, message, active_until, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("ecom-001", "aria", "ollama-1", "ollama", "llama3:latest", "rate_limit", "cooldown", Date.now() + 60_000, now);

      const briefing = buildGuildSgmBriefing(db, "ecom-001", now);

      expect(briefing.metrics).toMatchObject({ runtimeAvailable: 0, runtimeLimited: 1 });
      expect(briefing.bullets.some((bullet) => bullet.includes("Blocked roles without available runtime: techLead"))).toBe(
        true,
      );
      expect(briefing.nextActions).toContainEqual({
        key: "restore_runtime",
        label: "Restore runtime availability for blocked roles",
        priority: "high",
      });
    } finally {
      db.close();
    }
  });
});
