import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyBaseSchema } from "../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { buildGuildBudgetGuardStatus, updateGuildBudgetPolicy } from "./budget-guard.ts";

function seed(db: DatabaseSync, now: number): void {
  applyBaseSchema(db);
  applyGuildAiSchema(db);
  db.prepare("INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json) VALUES (?, ?, ?, ?, ?)").run(
    "ecom-001",
    "E-Commerce",
    "ecommerce",
    "USD",
    "{}",
  );
  db.prepare(
    "INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model, budget_usd_daily) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("ecom-001", "worker-001", "worker", "Worker", "llama3", 0.5);
  db.prepare(
    "INSERT INTO guild_token_usage (guild_id, agent_id, provider, model, total_tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("ecom-001", "worker-001", "openai", "gpt-test", 1000, 0.75, now);
}

describe("Guild AI budget guard", () => {
  it("blocks when hard stop is enabled and daily budget is exceeded", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const now = Date.UTC(2026, 5, 5, 8, 0, 0);
      seed(db, now);
      updateGuildBudgetPolicy(db, {
        guildId: "ecom-001",
        dailyBudgetUsd: 0.5,
        monthlyBudgetUsd: 10,
        hardStopEnabled: true,
        warnThresholdPercent: 80,
        updatedAt: now,
      });

      const status = buildGuildBudgetGuardStatus(db, "ecom-001", now);
      expect(status.verdict).toBe("blocked");
      expect(status.agentSpend[0]?.status).toBe("blocked");
      expect(status.dailyRemainingUsd).toBe(0);
    } finally {
      db.close();
    }
  });
});
