import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { GuildBackupReadiness } from "./backup-readiness.ts";
import type { GuildBudgetGuardStatus } from "./budget-guard.ts";
import type { GuildDeploymentReadiness } from "./deployment-readiness.ts";
import type { GuildLaunchReadiness } from "./launch-readiness.ts";
import type { GuildWorkerQueueStatus } from "./worker-queue.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildCoreStabilityGate = {
  key: string;
  label: string;
  status: "pass" | "watch" | "fail";
  detail: string;
};

export type GuildCoreStabilitySummary = {
  ok: boolean;
  guildId: string;
  generatedAt: number;
  score: number;
  gates: GuildCoreStabilityGate[];
  counts: {
    templates: number;
    runtimeBindings: number;
    activeModelLimits: number;
    memoryRecords: number;
    pendingGovernanceDecisions: number;
    pendingReviews: number;
    workerQueued: number;
  };
  nextActions: string[];
};

function count(db: DbLike, sql: string, ...params: SQLInputValue[]): number {
  const row = db.prepare(sql).get(...params) as { count: number } | undefined;
  return row?.count ?? 0;
}

async function checkOllama(baseUrl: string): Promise<GuildCoreStabilityGate> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { key: "ollama", label: "Ollama availability", status: "watch", detail: `${res.status} ${res.statusText}` };
    const body = (await res.json()) as { data?: unknown[] };
    return { key: "ollama", label: "Ollama availability", status: "pass", detail: `${body.data?.length ?? 0} model(s)` };
  } catch (err) {
    return {
      key: "ollama",
      label: "Ollama availability",
      status: "watch",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function buildGuildCoreStabilitySummary(input: {
  db: DbLike;
  guildId: string;
  generatedAt: number;
  launch: GuildLaunchReadiness;
  deployment: GuildDeploymentReadiness;
  backup: GuildBackupReadiness;
  budget: GuildBudgetGuardStatus;
  workerQueue: GuildWorkerQueueStatus;
  ollamaBaseUrl?: string;
}): Promise<GuildCoreStabilitySummary> {
  const { db, guildId, generatedAt } = input;
  const templates = count(db, "SELECT COUNT(*) AS count FROM guild_templates");
  const runtimeBindings = count(db, "SELECT COUNT(*) AS count FROM guild_runtime_bindings WHERE guild_id = ? AND status = 'active'", guildId);
  const activeModelLimits = count(
    db,
    "SELECT COUNT(*) AS count FROM guild_ai_limit_events WHERE guild_id = ? AND active_until IS NOT NULL AND active_until > ?",
    guildId,
    generatedAt,
  );
  const memoryRecords = count(db, "SELECT COUNT(*) AS count FROM guild_memory_records WHERE guild_id = ?", guildId);
  const pendingGovernanceDecisions =
    count(db, "SELECT COUNT(*) AS count FROM guild_upgrade_proposals WHERE guild_id = ? AND status = 'pending'", guildId) +
    count(db, "SELECT COUNT(*) AS count FROM guild_governance_requests WHERE guild_id = ? AND status = 'pending'", guildId);
  const pendingReviews = count(db, "SELECT COUNT(*) AS count FROM guild_review_queue WHERE guild_id = ? AND status IN ('pending','in_review','needs_info')", guildId);
  const latestSmoke = db
    .prepare(
      `SELECT status, workflow_meta_json
       FROM tasks
       WHERE workflow_meta_json LIKE ?
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(`%"guildId":"${guildId}"%`) as { status: string; workflow_meta_json: string } | undefined;
  const latestPm = db
    .prepare("SELECT report_date, generated_at FROM guild_pm_daily_reports WHERE guild_id = ? ORDER BY generated_at DESC LIMIT 1")
    .get(guildId) as { report_date: string; generated_at: number } | undefined;

  const gates: GuildCoreStabilityGate[] = [
    { key: "server", label: "Server health", status: "pass", detail: "Guild AI route is responding." },
    {
      key: "templates",
      label: "Guild templates",
      status: templates >= 3 ? "pass" : templates > 0 ? "watch" : "fail",
      detail: `${templates} template(s) seeded.`,
    },
    {
      key: "runtime",
      label: "Runtime bindings",
      status: runtimeBindings >= 6 ? "pass" : runtimeBindings > 0 ? "watch" : "fail",
      detail: `${runtimeBindings} active binding(s).`,
    },
    await checkOllama(input.ollamaBaseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"),
    {
      key: "limits",
      label: "Active model limits",
      status: activeModelLimits === 0 ? "pass" : "watch",
      detail: `${activeModelLimits} active limit(s).`,
    },
    {
      key: "accounting",
      label: "Accounting readiness",
      status: input.launch.gates.find((gate) => gate.key === "accounting")?.status === "ready" ? "pass" : "watch",
      detail: input.launch.gates.find((gate) => gate.key === "accounting")?.detail ?? "not checked",
    },
    {
      key: "budget",
      label: "Budget guard",
      status: input.budget.verdict === "blocked" ? "fail" : input.budget.verdict === "warning" ? "watch" : "pass",
      detail: `${input.budget.verdict}, daily ${input.budget.dailySpendUsd}/${input.budget.policy.daily_budget_usd}`,
    },
    {
      key: "queue",
      label: "Worker queue",
      status: input.workerQueue.counts.failed > 0 ? "watch" : "pass",
      detail: `${input.workerQueue.counts.queued} queued, ${input.workerQueue.counts.running} running, ${input.workerQueue.counts.failed} failed.`,
    },
    {
      key: "backup",
      label: "Backup readiness",
      status: input.backup.ready ? "pass" : "watch",
      detail: input.backup.nextActions[0] ?? "backup checked",
    },
    {
      key: "security",
      label: "Security readiness",
      status: input.deployment.readyForInternet ? "pass" : input.deployment.readyForLan ? "watch" : "watch",
      detail: input.deployment.nextActions[0] ?? `${input.deployment.mode} mode`,
    },
    {
      key: "smoke",
      label: "Latest smoke",
      status: latestSmoke ? (["done", "review"].includes(latestSmoke.status) ? "pass" : "watch") : "watch",
      detail: latestSmoke ? latestSmoke.status : "no smoke task found",
    },
    {
      key: "pm_report",
      label: "Latest PM report",
      status: latestPm ? "pass" : "watch",
      detail: latestPm ? latestPm.report_date : "no report generated yet",
    },
    {
      key: "memory",
      label: "Memory records",
      status: memoryRecords > 0 ? "pass" : "watch",
      detail: `${memoryRecords} memory record(s).`,
    },
    {
      key: "governance",
      label: "Pending governance",
      status: pendingGovernanceDecisions === 0 ? "pass" : "watch",
      detail: `${pendingGovernanceDecisions} pending governance decision(s).`,
    },
  ];
  const score = Math.round(
    (gates.reduce((sum, gate) => sum + (gate.status === "pass" ? 1 : gate.status === "watch" ? 0.5 : 0), 0) / gates.length) * 100,
  );
  const nextActions = gates
    .filter((gate) => gate.status !== "pass")
    .map((gate) => `${gate.label}: ${gate.detail}`)
    .slice(0, 8);
  if (nextActions.length === 0) nextActions.push("Core stability is healthy; continue local-first operation and monitor drift.");

  return {
    ok: true,
    guildId,
    generatedAt,
    score,
    gates,
    counts: {
      templates,
      runtimeBindings,
      activeModelLimits,
      memoryRecords,
      pendingGovernanceDecisions,
      pendingReviews,
      workerQueued: input.workerQueue.counts.queued,
    },
    nextActions,
  };
}
