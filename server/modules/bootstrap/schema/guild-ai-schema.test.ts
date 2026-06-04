import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyGuildAiSchema } from "./guild-ai-schema.ts";

function tableNames(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>)
    .map((row) => row.name)
    .filter((name) => name.startsWith("guild_"));
}

describe("Guild AI schema", () => {
  it("creates governance, advice, memory, and accounting tables", () => {
    const db = new DatabaseSync(":memory:");

    try {
      applyGuildAiSchema(db);

      expect(tableNames(db)).toEqual(
        expect.arrayContaining([
          "guild_accounting_accounts",
          "guild_accounting_journal_entries",
          "guild_accounting_journal_lines",
          "guild_ai_credit_topups",
          "guild_agent_roles",
          "guild_capability_levels",
          "guild_governance_requests",
          "guild_human_advice",
          "guild_memory_records",
          "guild_model_pricing",
          "guild_revenue_records",
          "guild_runtime_bindings",
          "guild_templates",
          "guild_token_usage",
          "guild_upgrade_events",
          "guild_upgrade_proposals",
        ]),
      );
    } finally {
      db.close();
    }
  });
});
