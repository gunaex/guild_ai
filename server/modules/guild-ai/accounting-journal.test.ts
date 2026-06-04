import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import {
  estimateTokenCostUsd,
  getPrepaidAiCreditBalance,
  getProfitAndLossSummary,
  recordAiCreditTopupWithJournal,
  recordServiceRevenueWithJournal,
  recordTokenUsageWithJournal,
  upsertModelPricing,
} from "./accounting-journal.ts";

describe("Guild AI accounting journal", () => {
  it("records token usage as a balanced double-entry journal entry", () => {
    const db = new DatabaseSync(":memory:");

    try {
      applyGuildAiSchema(db);

      const result = recordTokenUsageWithJournal(db, {
        guildId: "ecom-001",
        agentId: "worker-001",
        provider: "litellm",
        model: "local/gemma",
        promptTokens: 100,
        completionTokens: 25,
        costUsd: 1.25,
        createdAt: Date.UTC(2026, 0, 2),
      });

      expect(result.totalTokens).toBe(125);
      expect(result.journalEntryId).toBeTruthy();

      const totals = db
        .prepare(
          `SELECT COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit
           FROM guild_accounting_journal_lines
           WHERE entry_id = ?`,
        )
        .get(result.journalEntryId) as { debit: number; credit: number };

      expect(totals).toEqual({ debit: 1.25, credit: 1.25 });

      const expenseLine = db
        .prepare("SELECT account_code, debit, credit FROM guild_accounting_journal_lines WHERE account_code = '5000'")
        .get() as { account_code: string; debit: number; credit: number };

      expect(expenseLine).toEqual({ account_code: "5000", debit: 1.25, credit: 0 });
    } finally {
      db.close();
    }
  });

  it("estimates token cost from configured model pricing when cost is not supplied", () => {
    const db = new DatabaseSync(":memory:");

    try {
      applyGuildAiSchema(db);
      upsertModelPricing(db, {
        guildId: "ecom-001",
        provider: "openai",
        model: "gpt-test",
        promptUsdPerMillion: 2,
        completionUsdPerMillion: 10,
        source: "test",
        createdAt: Date.UTC(2026, 0, 2),
      });

      expect(
        estimateTokenCostUsd(db, {
          guildId: "ecom-001",
          provider: "openai",
          model: "gpt-test",
          promptTokens: 1_000_000,
          completionTokens: 500_000,
        }),
      ).toBe(7);

      const result = recordTokenUsageWithJournal(db, {
        guildId: "ecom-001",
        agentId: "worker-001",
        provider: "openai",
        model: "gpt-test",
        promptTokens: 1_000_000,
        completionTokens: 500_000,
        createdAt: Date.UTC(2026, 0, 2),
      });

      expect(result.costUsd).toBe(7);
      expect(result.journalEntryId).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it("uses provider wildcard pricing when exact model pricing is absent", () => {
    const db = new DatabaseSync(":memory:");

    try {
      applyGuildAiSchema(db);
      upsertModelPricing(db, {
        guildId: "ecom-001",
        provider: "openai",
        model: "*",
        promptUsdPerMillion: 1,
        completionUsdPerMillion: 3,
        createdAt: Date.UTC(2026, 0, 2),
      });

      expect(
        estimateTokenCostUsd(db, {
          guildId: "ecom-001",
          provider: "OpenAI",
          model: "unknown-model",
          promptTokens: 500_000,
          completionTokens: 500_000,
        }),
      ).toBe(2);
    } finally {
      db.close();
    }
  });

  it("summarizes P&L from revenue and expense account categories", () => {
    const db = new DatabaseSync(":memory:");

    try {
      applyGuildAiSchema(db);

      recordTokenUsageWithJournal(db, {
        guildId: "ecom-001",
        agentId: "worker-001",
        provider: "litellm",
        model: "gpt-4o",
        promptTokens: 10,
        completionTokens: 10,
        costUsd: 2,
        createdAt: Date.UTC(2026, 0, 2),
      });
      recordServiceRevenueWithJournal(db, {
        guildId: "ecom-001",
        customerName: "Acme Co.",
        description: "AI operations service revenue",
        amountUsd: 10,
        receivedTo: "cash",
        createdAt: Date.UTC(2026, 0, 3),
      });

      const pnl = getProfitAndLossSummary(db, "ecom-001");

      expect(pnl).toEqual({
        guildId: "ecom-001",
        revenue: 10,
        expenses: 2,
        netIncome: 8,
      });
    } finally {
      db.close();
    }
  });

  it("records service revenue as a balanced double-entry journal entry", () => {
    const db = new DatabaseSync(":memory:");

    try {
      applyGuildAiSchema(db);

      const result = recordServiceRevenueWithJournal(db, {
        guildId: "ecom-001",
        customerName: "Acme Co.",
        description: "AI operations service revenue",
        amountUsd: 12.345,
        receivedTo: "accounts_receivable",
        sourceType: "invoice",
        sourceId: "INV-001",
        createdAt: Date.UTC(2026, 0, 3),
      });

      expect(result.amountUsd).toBe(12.35);
      expect(result.journalEntryId).toBeTruthy();

      const totals = db
        .prepare(
          `SELECT COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit
           FROM guild_accounting_journal_lines
           WHERE entry_id = ?`,
        )
        .get(result.journalEntryId) as { debit: number; credit: number };

      expect(totals).toEqual({ debit: 12.35, credit: 12.35 });

      const lines = db
        .prepare(
          `SELECT account_code, debit, credit
           FROM guild_accounting_journal_lines
           WHERE entry_id = ?
           ORDER BY account_code ASC`,
        )
        .all(result.journalEntryId);

      expect(lines).toEqual([
        { account_code: "1200", debit: 12.35, credit: 0 },
        { account_code: "4000", debit: 0, credit: 12.35 },
      ]);
    } finally {
      db.close();
    }
  });

  it("records AI credit top-ups and reduces prepaid balance when token usage spends them", () => {
    const db = new DatabaseSync(":memory:");

    try {
      applyGuildAiSchema(db);

      const topup = recordAiCreditTopupWithJournal(db, {
        guildId: "ecom-001",
        provider: "openai",
        description: "AI provider credit top-up",
        amountUsd: 10,
        paidFrom: "cash",
        createdAt: Date.UTC(2026, 0, 4),
      });

      expect(topup.amountUsd).toBe(10);
      expect(getPrepaidAiCreditBalance(db, "ecom-001")).toBe(10);

      const topupLines = db
        .prepare(
          `SELECT account_code, debit, credit
           FROM guild_accounting_journal_lines
           WHERE entry_id = ?
           ORDER BY account_code ASC`,
        )
        .all(topup.journalEntryId);

      expect(topupLines).toEqual([
        { account_code: "1000", debit: 0, credit: 10 },
        { account_code: "1100", debit: 10, credit: 0 },
      ]);

      recordTokenUsageWithJournal(db, {
        guildId: "ecom-001",
        agentId: "worker-001",
        provider: "openai",
        model: "gpt-test",
        promptTokens: 10,
        completionTokens: 10,
        costUsd: 3,
        paidFrom: "prepaid_ai_credits",
        createdAt: Date.UTC(2026, 0, 5),
      });

      expect(getPrepaidAiCreditBalance(db, "ecom-001")).toBe(7);
    } finally {
      db.close();
    }
  });
});
