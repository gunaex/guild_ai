import type { DatabaseSync } from "node:sqlite";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildBudgetPolicy = {
  guild_id: string;
  daily_budget_usd: number;
  monthly_budget_usd: number;
  hard_stop_enabled: number;
  warn_threshold_percent: number;
  updated_at: number;
};

export type GuildBudgetGuardStatus = {
  guildId: string;
  generatedAt: number;
  policy: GuildBudgetPolicy;
  dailySpendUsd: number;
  monthlySpendUsd: number;
  dailyRemainingUsd: number;
  monthlyRemainingUsd: number;
  dailyPercent: number;
  monthlyPercent: number;
  verdict: "ok" | "warning" | "blocked";
  agentSpend: Array<{
    agentId: string;
    displayName: string;
    roleKey: string;
    dailyBudgetUsd: number | null;
    todaySpendUsd: number;
    percent: number | null;
    status: "ok" | "warning" | "blocked";
  }>;
  nextActions: string[];
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function percent(spend: number, budget: number): number {
  if (budget <= 0) return 0;
  return Math.min(999, Math.round((spend / budget) * 100));
}

function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function monthStart(ts: number): number {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function getOrCreateGuildBudgetPolicy(db: DbLike, guildId: string, now: number): GuildBudgetPolicy {
  const existing = db.prepare("SELECT * FROM guild_budget_policies WHERE guild_id = ?").get(guildId) as
    | GuildBudgetPolicy
    | undefined;
  if (existing) return existing;

  db.prepare(
    `INSERT INTO guild_budget_policies (
      guild_id, daily_budget_usd, monthly_budget_usd, hard_stop_enabled, warn_threshold_percent, updated_at
    ) VALUES (?, 10, 300, 1, 80, ?)`,
  ).run(guildId, now);
  return db.prepare("SELECT * FROM guild_budget_policies WHERE guild_id = ?").get(guildId) as GuildBudgetPolicy;
}

export function updateGuildBudgetPolicy(
  db: DbLike,
  input: {
    guildId: string;
    dailyBudgetUsd: number;
    monthlyBudgetUsd: number;
    hardStopEnabled: boolean;
    warnThresholdPercent: number;
    updatedAt: number;
  },
): GuildBudgetPolicy {
  const daily = roundMoney(Number(input.dailyBudgetUsd));
  const monthly = roundMoney(Number(input.monthlyBudgetUsd));
  const warn = Math.max(1, Math.min(100, Math.floor(Number(input.warnThresholdPercent))));
  if (!Number.isFinite(daily) || daily < 0) throw new Error("dailyBudgetUsd must be a non-negative number.");
  if (!Number.isFinite(monthly) || monthly < 0) throw new Error("monthlyBudgetUsd must be a non-negative number.");
  if (monthly > 0 && daily > monthly) throw new Error("dailyBudgetUsd cannot exceed monthlyBudgetUsd.");

  db.prepare(
    `INSERT INTO guild_budget_policies (
      guild_id, daily_budget_usd, monthly_budget_usd, hard_stop_enabled, warn_threshold_percent, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      daily_budget_usd = excluded.daily_budget_usd,
      monthly_budget_usd = excluded.monthly_budget_usd,
      hard_stop_enabled = excluded.hard_stop_enabled,
      warn_threshold_percent = excluded.warn_threshold_percent,
      updated_at = excluded.updated_at`,
  ).run(input.guildId, daily, monthly, input.hardStopEnabled ? 1 : 0, warn, input.updatedAt);

  return getOrCreateGuildBudgetPolicy(db, input.guildId, input.updatedAt);
}

export function buildGuildBudgetGuardStatus(db: DbLike, guildId: string, generatedAt: number): GuildBudgetGuardStatus {
  const policy = getOrCreateGuildBudgetPolicy(db, guildId, generatedAt);
  const todayStart = dayStart(generatedAt);
  const currentMonthStart = monthStart(generatedAt);
  const dailySpendUsd = roundMoney(
    Number(
      (
        db
          .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM guild_token_usage WHERE guild_id = ? AND created_at >= ?")
          .get(guildId, todayStart) as { total: number }
      ).total,
    ),
  );
  const monthlySpendUsd = roundMoney(
    Number(
      (
        db
          .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM guild_token_usage WHERE guild_id = ? AND created_at >= ?")
          .get(guildId, currentMonthStart) as { total: number }
      ).total,
    ),
  );

  const dailyPercent = percent(dailySpendUsd, policy.daily_budget_usd);
  const monthlyPercent = percent(monthlySpendUsd, policy.monthly_budget_usd);
  const budgetExceeded =
    (policy.daily_budget_usd > 0 && dailySpendUsd >= policy.daily_budget_usd) ||
    (policy.monthly_budget_usd > 0 && monthlySpendUsd >= policy.monthly_budget_usd);
  const nearBudget = dailyPercent >= policy.warn_threshold_percent || monthlyPercent >= policy.warn_threshold_percent;
  const verdict = budgetExceeded && policy.hard_stop_enabled === 1 ? "blocked" : nearBudget ? "warning" : "ok";

  const spendByAgent = new Map<string, number>();
  const rows = db
    .prepare(
      `SELECT agent_id, COALESCE(SUM(cost_usd), 0) AS total
       FROM guild_token_usage
       WHERE guild_id = ? AND created_at >= ?
       GROUP BY agent_id`,
    )
    .all(guildId, todayStart) as Array<{ agent_id: string; total: number }>;
  for (const row of rows) spendByAgent.set(row.agent_id, roundMoney(Number(row.total)));

  const roles = db
    .prepare(
      `SELECT agent_id, display_name, role_key, budget_usd_daily
       FROM guild_agent_roles
       WHERE guild_id = ?
       ORDER BY role_key ASC, display_name ASC`,
    )
    .all(guildId) as Array<{
    agent_id: string;
    display_name: string;
    role_key: string;
    budget_usd_daily: number | null;
  }>;

  const agentSpend = roles.map((role) => {
    const spend = spendByAgent.get(role.agent_id) ?? 0;
    const agentPercent = role.budget_usd_daily && role.budget_usd_daily > 0 ? percent(spend, role.budget_usd_daily) : null;
    const status: "ok" | "warning" | "blocked" =
      agentPercent !== null && agentPercent >= 100 && policy.hard_stop_enabled === 1
        ? "blocked"
        : agentPercent !== null && agentPercent >= policy.warn_threshold_percent
          ? "warning"
          : "ok";
    return {
      agentId: role.agent_id,
      displayName: role.display_name,
      roleKey: role.role_key,
      dailyBudgetUsd: role.budget_usd_daily,
      todaySpendUsd: spend,
      percent: agentPercent,
      status,
    };
  });

  const nextActions: string[] = [];
  if (verdict === "blocked") nextActions.push("Budget hard stop is active. Pause paid provider work or raise the budget.");
  if (verdict === "warning") nextActions.push("Budget is near threshold. Prefer local Ollama or cheaper backup bindings.");
  if (agentSpend.some((agent) => agent.status === "blocked")) nextActions.push("Review agents whose daily budget is exhausted.");
  if (nextActions.length === 0) nextActions.push("Budget guard is healthy. Keep monitoring daily and monthly spend.");

  return {
    guildId,
    generatedAt,
    policy,
    dailySpendUsd,
    monthlySpendUsd,
    dailyRemainingUsd: roundMoney(Math.max(0, policy.daily_budget_usd - dailySpendUsd)),
    monthlyRemainingUsd: roundMoney(Math.max(0, policy.monthly_budget_usd - monthlySpendUsd)),
    dailyPercent,
    monthlyPercent,
    verdict,
    agentSpend,
    nextActions,
  };
}
