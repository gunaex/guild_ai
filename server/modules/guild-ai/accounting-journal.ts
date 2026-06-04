import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { seedStarterChartOfAccounts } from "./accounting.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export type TokenUsageJournalInput = {
  guildId: string;
  agentId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd?: number | null;
  paidFrom?: "accounts_payable" | "prepaid_ai_credits";
  entryDate?: string;
  createdAt: number;
};

export type ServiceRevenueJournalInput = {
  guildId: string;
  customerName?: string | null;
  description: string;
  amountUsd: number;
  receivedTo?: "cash" | "accounts_receivable";
  sourceType?: string;
  sourceId?: string | null;
  entryDate?: string;
  createdAt: number;
};

export type AiCreditTopupJournalInput = {
  guildId: string;
  provider: string;
  description: string;
  amountUsd: number;
  paidFrom?: "cash" | "accounts_payable" | "owner_capital";
  sourceType?: string;
  sourceId?: string | null;
  entryDate?: string;
  createdAt: number;
};

export type ProfitAndLossSummary = {
  guildId: string;
  revenue: number;
  expenses: number;
  netIncome: number;
};

export type ModelPricingInput = {
  guildId: string;
  provider: string;
  model: string;
  promptUsdPerMillion: number;
  completionUsdPerMillion: number;
  source?: string;
  createdAt: number;
};

export type ModelPricingRow = {
  guild_id: string;
  provider: string;
  model: string;
  prompt_usd_per_million: number;
  completion_usd_per_million: number;
  currency: string;
  source: string;
  created_at: number;
  updated_at: number;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertNonNegativeFinite(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite number.`);
  }
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

export function estimateTokenCostUsd(
  db: DbLike,
  input: { guildId: string; provider: string; model: string; promptTokens: number; completionTokens: number },
): number {
  const provider = normalizeKey(input.provider);
  const model = input.model.trim();
  if (!provider || !model) return 0;

  const pricing = db
    .prepare(
      `SELECT prompt_usd_per_million, completion_usd_per_million
       FROM guild_model_pricing
       WHERE guild_id = ?
         AND LOWER(provider) = ?
         AND (model = ? OR model = '*')
       ORDER BY CASE WHEN model = ? THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .get(input.guildId, provider, model, model) as
    | { prompt_usd_per_million: number; completion_usd_per_million: number }
    | undefined;

  if (!pricing) return 0;
  const promptCost = (Math.floor(input.promptTokens) / 1_000_000) * pricing.prompt_usd_per_million;
  const completionCost = (Math.floor(input.completionTokens) / 1_000_000) * pricing.completion_usd_per_million;
  return roundMoney(promptCost + completionCost);
}

export function upsertModelPricing(db: DbLike, input: ModelPricingInput): ModelPricingRow {
  const provider = normalizeKey(input.provider);
  const model = input.model.trim();
  const promptUsdPerMillion = Number(input.promptUsdPerMillion);
  const completionUsdPerMillion = Number(input.completionUsdPerMillion);
  assertNonNegativeFinite(promptUsdPerMillion, "promptUsdPerMillion");
  assertNonNegativeFinite(completionUsdPerMillion, "completionUsdPerMillion");
  if (!input.guildId.trim() || !provider || !model) {
    throw new Error("guildId, provider, and model are required.");
  }

  db.prepare(
    `INSERT INTO guild_model_pricing (
      guild_id, provider, model, prompt_usd_per_million, completion_usd_per_million, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, provider, model) DO UPDATE SET
      prompt_usd_per_million = excluded.prompt_usd_per_million,
      completion_usd_per_million = excluded.completion_usd_per_million,
      source = excluded.source,
      updated_at = excluded.updated_at`,
  ).run(
    input.guildId.trim(),
    provider,
    model,
    promptUsdPerMillion,
    completionUsdPerMillion,
    input.source?.trim() || "manual",
    input.createdAt,
    input.createdAt,
  );

  return db
    .prepare(
      `SELECT *
       FROM guild_model_pricing
       WHERE guild_id = ? AND provider = ? AND model = ?`,
    )
    .get(input.guildId.trim(), provider, model) as ModelPricingRow;
}

export function listModelPricing(db: DbLike, guildId: string): ModelPricingRow[] {
  return db
    .prepare(
      `SELECT *
       FROM guild_model_pricing
       WHERE guild_id = ?
       ORDER BY provider ASC, model ASC`,
    )
    .all(guildId) as ModelPricingRow[];
}

export function recordTokenUsageWithJournal(db: DbLike, input: TokenUsageJournalInput): {
  usageId: number;
  journalEntryId: string | null;
  totalTokens: number;
  costUsd: number;
} {
  const promptTokens = Math.floor(input.promptTokens);
  const completionTokens = Math.floor(input.completionTokens);
  const explicitCostUsd = Number(input.costUsd ?? 0);
  const costUsd = roundMoney(
    explicitCostUsd > 0
      ? explicitCostUsd
      : estimateTokenCostUsd(db, {
          guildId: input.guildId,
          provider: input.provider,
          model: input.model,
          promptTokens,
          completionTokens,
        }),
  );

  assertNonNegativeFinite(promptTokens, "promptTokens");
  assertNonNegativeFinite(completionTokens, "completionTokens");
  assertNonNegativeFinite(costUsd, "costUsd");

  seedStarterChartOfAccounts(db, input.guildId);

  const totalTokens = promptTokens + completionTokens;
  const usageResult = db
    .prepare(
      `INSERT INTO guild_token_usage (
        guild_id, agent_id, provider, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.guildId,
      input.agentId,
      input.provider,
      input.model,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd,
      input.createdAt,
    );

  const usageId = Number(usageResult.lastInsertRowid);
  if (costUsd <= 0) {
    return { usageId, journalEntryId: null, totalTokens, costUsd };
  }

  const entryId = randomUUID();
  const creditAccount = input.paidFrom === "prepaid_ai_credits" ? "1100" : "2000";
  const entryDate = input.entryDate ?? new Date(input.createdAt).toISOString().slice(0, 10);
  const description = `AI token usage: ${input.provider}/${input.model}`;

  db.prepare(
    `INSERT INTO guild_accounting_journal_entries (
      id, guild_id, entry_date, description, source_type, source_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(entryId, input.guildId, entryDate, description, "token_usage", String(usageId), input.createdAt);

  const insertLine = db.prepare(
    `INSERT INTO guild_accounting_journal_lines (
      entry_id, guild_id, account_code, debit, credit, memo, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  insertLine.run(entryId, input.guildId, "5000", costUsd, 0, "ค่าใช้จ่ายโทเคน AI", input.createdAt);
  insertLine.run(entryId, input.guildId, creditAccount, 0, costUsd, "บันทึกภาระจ่ายค่า AI", input.createdAt);

  return { usageId, journalEntryId: entryId, totalTokens, costUsd };
}

export function recordServiceRevenueWithJournal(db: DbLike, input: ServiceRevenueJournalInput): {
  revenueId: number;
  journalEntryId: string;
  amountUsd: number;
} {
  const amountUsd = roundMoney(input.amountUsd);
  assertNonNegativeFinite(amountUsd, "amountUsd");
  if (amountUsd <= 0) {
    throw new Error("amountUsd must be greater than zero.");
  }
  if (!input.description.trim()) {
    throw new Error("description is required.");
  }

  seedStarterChartOfAccounts(db, input.guildId);

  const receivedTo = input.receivedTo === "accounts_receivable" ? "accounts_receivable" : "cash";
  const debitAccount = receivedTo === "accounts_receivable" ? "1200" : "1000";
  const sourceType = input.sourceType?.trim() || "manual";
  const sourceId = input.sourceId?.trim() || null;

  const revenueResult = db
    .prepare(
      `INSERT INTO guild_revenue_records (
        guild_id, customer_name, description, amount_usd, received_to, source_type, source_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.guildId,
      input.customerName?.trim() || null,
      input.description.trim(),
      amountUsd,
      receivedTo,
      sourceType,
      sourceId,
      input.createdAt,
    );

  const revenueId = Number(revenueResult.lastInsertRowid);
  const entryId = randomUUID();
  const entryDate = input.entryDate ?? new Date(input.createdAt).toISOString().slice(0, 10);

  db.prepare(
    `INSERT INTO guild_accounting_journal_entries (
      id, guild_id, entry_date, description, source_type, source_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(entryId, input.guildId, entryDate, input.description.trim(), "service_revenue", String(revenueId), input.createdAt);

  const insertLine = db.prepare(
    `INSERT INTO guild_accounting_journal_lines (
      entry_id, guild_id, account_code, debit, credit, memo, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  insertLine.run(entryId, input.guildId, debitAccount, amountUsd, 0, "บันทึกรับรู้รายได้", input.createdAt);
  insertLine.run(entryId, input.guildId, "4000", 0, amountUsd, "รายได้ค่าบริการ", input.createdAt);

  return { revenueId, journalEntryId: entryId, amountUsd };
}

export function recordAiCreditTopupWithJournal(db: DbLike, input: AiCreditTopupJournalInput): {
  topupId: number;
  journalEntryId: string;
  amountUsd: number;
} {
  const amountUsd = roundMoney(input.amountUsd);
  assertNonNegativeFinite(amountUsd, "amountUsd");
  if (amountUsd <= 0) {
    throw new Error("amountUsd must be greater than zero.");
  }
  if (!input.provider.trim()) {
    throw new Error("provider is required.");
  }
  if (!input.description.trim()) {
    throw new Error("description is required.");
  }

  seedStarterChartOfAccounts(db, input.guildId);

  const paidFrom =
    input.paidFrom === "accounts_payable" || input.paidFrom === "owner_capital" ? input.paidFrom : "cash";
  const creditAccount = paidFrom === "accounts_payable" ? "2000" : paidFrom === "owner_capital" ? "3000" : "1000";
  const sourceType = input.sourceType?.trim() || "manual";
  const sourceId = input.sourceId?.trim() || null;

  const topupResult = db
    .prepare(
      `INSERT INTO guild_ai_credit_topups (
        guild_id, provider, description, amount_usd, paid_from, source_type, source_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.guildId,
      input.provider.trim(),
      input.description.trim(),
      amountUsd,
      paidFrom,
      sourceType,
      sourceId,
      input.createdAt,
    );

  const topupId = Number(topupResult.lastInsertRowid);
  const entryId = randomUUID();
  const entryDate = input.entryDate ?? new Date(input.createdAt).toISOString().slice(0, 10);

  db.prepare(
    `INSERT INTO guild_accounting_journal_entries (
      id, guild_id, entry_date, description, source_type, source_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(entryId, input.guildId, entryDate, input.description.trim(), "ai_credit_topup", String(topupId), input.createdAt);

  const insertLine = db.prepare(
    `INSERT INTO guild_accounting_journal_lines (
      entry_id, guild_id, account_code, debit, credit, memo, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  insertLine.run(entryId, input.guildId, "1100", amountUsd, 0, "เติมเครดิต AI จ่ายล่วงหน้า", input.createdAt);
  insertLine.run(entryId, input.guildId, creditAccount, 0, amountUsd, "แหล่งเงินสำหรับเครดิต AI", input.createdAt);

  return { topupId, journalEntryId: entryId, amountUsd };
}

export function getPrepaidAiCreditBalance(db: DbLike, guildId: string): number {
  seedStarterChartOfAccounts(db, guildId);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(debit - credit), 0) AS balance
       FROM guild_accounting_journal_lines
       WHERE guild_id = ? AND account_code = '1100'`,
    )
    .get(guildId) as { balance: number } | undefined;
  return roundMoney(Number(row?.balance ?? 0));
}

export function getProfitAndLossSummary(db: DbLike, guildId: string): ProfitAndLossSummary {
  seedStarterChartOfAccounts(db, guildId);

  const rows = db
    .prepare(
      `SELECT a.category, COALESCE(SUM(l.credit - l.debit), 0) AS amount
       FROM guild_accounting_journal_lines l
       JOIN guild_accounting_accounts a
         ON a.guild_id = l.guild_id AND a.account_code = l.account_code
       WHERE l.guild_id = ? AND a.category IN ('revenue', 'expense')
       GROUP BY a.category`,
    )
    .all(guildId) as Array<{ category: "revenue" | "expense"; amount: number }>;

  const revenue = roundMoney(rows.find((row) => row.category === "revenue")?.amount ?? 0);
  const expenseCreditMinusDebit = rows.find((row) => row.category === "expense")?.amount ?? 0;
  const expenses = roundMoney(Math.abs(Math.min(expenseCreditMinusDebit, 0)));

  return {
    guildId,
    revenue,
    expenses,
    netIncome: roundMoney(revenue - expenses),
  };
}
