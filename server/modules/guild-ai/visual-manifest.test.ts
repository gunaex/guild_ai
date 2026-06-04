import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyBaseSchema } from "../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { recordServiceRevenueWithJournal } from "./accounting-journal.ts";
import { buildGuildVisualManifest } from "./visual-manifest.ts";

function seedVisualData(db: DatabaseSync, now: number): void {
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
  ).run("proposal-1", "ecom-001", "runtime", 2, "Improve runtime", "Need safer task flow", now, now);
  recordServiceRevenueWithJournal(db, {
    guildId: "ecom-001",
    description: "Service revenue",
    amountUsd: 10,
    createdAt: now,
  });
}

describe("Guild AI visual manifest", () => {
  it("builds a renderer-friendly state snapshot from live guild data", () => {
    const db = new DatabaseSync(":memory:");
    const now = Date.UTC(2026, 0, 2);
    try {
      seedVisualData(db, now);

      const manifest = buildGuildVisualManifest(db, "ecom-001", now);

      expect(manifest.scene).toMatchObject({
        key: "local_ai_office",
        mood: "needs_decision",
      });
      expect(manifest.actors).toHaveLength(1);
      expect(manifest.actors[0]).toMatchObject({
        roleKey: "techLead",
        runtimeName: "Aria",
        providerName: "Local Ollama",
        visualState: "ready",
      });
      expect(manifest.accounting).toMatchObject({
        revenue: 10,
        netIncome: 10,
        visualState: "profit",
      });
      expect(manifest.governance).toMatchObject({
        pendingUpgrades: 1,
        visualState: "decision_needed",
      });
    } finally {
      db.close();
    }
  });
});
