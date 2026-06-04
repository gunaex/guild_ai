import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { seedStarterChartOfAccounts, THAI_ACCOUNTING_CATEGORIES } from "./accounting.ts";

describe("Guild AI Thai accounting foundation", () => {
  it("defines the five standard account categories", () => {
    expect(THAI_ACCOUNTING_CATEGORIES.map((category) => category.key)).toEqual([
      "asset",
      "liability",
      "equity",
      "revenue",
      "expense",
    ]);
  });

  it("seeds starter chart of accounts per guild", () => {
    const db = new DatabaseSync(":memory:");

    try {
      applyGuildAiSchema(db);
      seedStarterChartOfAccounts(db, "ecom-001");

      const rows = db
        .prepare(
          `SELECT account_code, account_name_th, category, normal_balance
           FROM guild_accounting_accounts
           WHERE guild_id = ?
           ORDER BY account_code ASC`,
        )
        .all("ecom-001") as Array<{
        account_code: string;
        account_name_th: string;
        category: string;
        normal_balance: string;
      }>;

      expect(rows.length).toBeGreaterThanOrEqual(8);
      expect(rows.find((row) => row.account_code === "5000")).toMatchObject({
        account_name_th: "ค่าใช้จ่ายโทเคน AI",
        category: "expense",
        normal_balance: "debit",
      });
    } finally {
      db.close();
    }
  });
});
