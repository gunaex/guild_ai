import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyGuildAiSchema } from "./guild-ai-schema.ts";
import { insertGuildTemplate, seedGuildAiTemplates } from "./guild-ai-seeds.ts";

const template = {
  guildId: "guild-test",
  name: "Test Guild",
  businessType: "testing",
  currency: "THB" as const,
  agents: [
    { id: "pm", displayName: "PM", role: "pm" as const, model: "gpt" },
    { id: "tech", displayName: "Tech", role: "techLead" as const, model: "gpt", reportsTo: "pm" },
    { id: "worker", displayName: "Worker", role: "worker" as const, model: "local", reportsTo: "tech" },
    { id: "qa", displayName: "QA", role: "qa" as const, model: "local", reportsTo: "tech" },
    { id: "hr", displayName: "HR", role: "hr" as const, model: "local", reportsTo: "pm" },
    { id: "acct", displayName: "Accounting", role: "accounting" as const, model: "local", reportsTo: "pm" },
  ],
};

describe("Guild AI seeds", () => {
  it("inserts template, roles, capability record, and starter accounts together", () => {
    const db = new DatabaseSync(":memory:");

    try {
      applyGuildAiSchema(db);
      insertGuildTemplate(db, template, 123);

      const templateCount = db.prepare("SELECT COUNT(*) AS count FROM guild_templates").get() as { count: number };
      const roleCount = db.prepare("SELECT COUNT(*) AS count FROM guild_agent_roles WHERE guild_id = ?").get("guild-test") as {
        count: number;
      };
      const capability = db
        .prepare("SELECT current_level, max_approved_level FROM guild_capability_levels WHERE guild_id = ?")
        .get("guild-test") as { current_level: number; max_approved_level: number };
      const accountCount = db
        .prepare("SELECT COUNT(*) AS count FROM guild_accounting_accounts WHERE guild_id = ?")
        .get("guild-test") as { count: number };

      expect(templateCount.count).toBe(1);
      expect(roleCount.count).toBe(6);
      expect(capability).toEqual({ current_level: 1, max_approved_level: 1 });
      expect(accountCount.count).toBeGreaterThanOrEqual(8);
    } finally {
      db.close();
    }
  });

  it("seeds bundled guild templates when available", () => {
    const db = new DatabaseSync(":memory:");

    try {
      applyGuildAiSchema(db);
      seedGuildAiTemplates(db, () => 456);

      const row = db.prepare("SELECT name, business_type FROM guild_templates WHERE guild_id = ?").get("ecom-001") as
        | { name: string; business_type: string }
        | undefined;
      const guildIds = db
        .prepare("SELECT guild_id AS guildId FROM guild_templates ORDER BY guild_id ASC")
        .all() as Array<{ guildId: string }>;

      expect(row).toEqual({ name: "Thai Commerce Ops", business_type: "e-commerce" });
      expect(guildIds.map((guild) => guild.guildId)).toEqual(["content-001", "ecom-001", "software-001"]);
    } finally {
      db.close();
    }
  });
});
