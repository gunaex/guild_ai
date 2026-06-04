import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyBaseSchema } from "../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { updateGuildBudgetPolicy } from "./budget-guard.ts";
import { buildGuildWorkerQueueStatus, enqueueGuildWorkerJob, processNextGuildWorkerQueueItem } from "./worker-queue.ts";

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
    "INSERT INTO guild_token_usage (guild_id, agent_id, provider, model, total_tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("ecom-001", "worker-001", "openai", "gpt-test", 1000, 2, now);
}

describe("Guild AI worker queue", () => {
  it("pauses processing when budget guard blocks and processes when budget is raised", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const now = Date.UTC(2026, 5, 5, 8, 0, 0);
      seed(db, now);
      enqueueGuildWorkerJob(db, { guildId: "ecom-001", title: "Do queued work", now });
      updateGuildBudgetPolicy(db, {
        guildId: "ecom-001",
        dailyBudgetUsd: 1,
        monthlyBudgetUsd: 10,
        hardStopEnabled: true,
        warnThresholdPercent: 80,
        updatedAt: now,
      });

      expect(processNextGuildWorkerQueueItem(db, { guildId: "ecom-001", now }).reason).toBe("budget_blocked");
      expect(buildGuildWorkerQueueStatus(db, "ecom-001", now).counts.queued).toBe(1);

      updateGuildBudgetPolicy(db, {
        guildId: "ecom-001",
        dailyBudgetUsd: 5,
        monthlyBudgetUsd: 10,
        hardStopEnabled: true,
        warnThresholdPercent: 80,
        updatedAt: now,
      });

      const result = processNextGuildWorkerQueueItem(db, { guildId: "ecom-001", now });
      expect(result.item?.status).toBe("succeeded");
      expect(buildGuildWorkerQueueStatus(db, "ecom-001", now).counts.succeeded).toBe(1);
    } finally {
      db.close();
    }
  });
});
