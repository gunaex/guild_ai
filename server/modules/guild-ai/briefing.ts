import type { DatabaseSync } from "node:sqlite";
import { listGuildRuntimeBindings } from "./runtime-bindings.ts";
import { buildGuildVisualManifest } from "./visual-manifest.ts";
import { countGuildMemories } from "./memory.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildSgmBriefing = {
  guildId: string;
  generatedAt: number;
  headline: string;
  status: "ready" | "needs_decision" | "watch_cost" | "warming_up";
  bullets: string[];
  nextActions: Array<{
    key: string;
    label: string;
    priority: "low" | "medium" | "high";
  }>;
  readiness: Array<{
    key: "runtime" | "limits" | "smoke" | "accounting" | "governance" | "memory" | "hr";
    label: string;
    status: "ready" | "action_needed" | "watch";
    detail: string;
  }>;
  metrics: {
    actors: number;
    pendingUpgrades: number;
    plannedTasks: number;
    netIncome: number;
    runtimeAvailable: number;
    runtimeLimited: number;
    memoryRecords: number;
    hrReviews: number;
    pendingGovernanceRequests: number;
  };
};

export function buildGuildSgmBriefing(db: DbLike, guildId: string, generatedAt: number): GuildSgmBriefing {
  const manifest = buildGuildVisualManifest(db, guildId, generatedAt);
  const bindings = listGuildRuntimeBindings(db as any, guildId);
  const runtimeAvailable = bindings.filter((binding) => binding.availability_status === "available").length;
  const runtimeLimited = bindings.filter((binding) => binding.availability_status === "limited").length;
  const runtimeDisabled = bindings.filter((binding) => binding.availability_status === "disabled").length;
  const roleAvailability = bindings.reduce<Record<string, { available: number; total: number }>>((acc, binding) => {
    const role = binding.guild_role_key;
    const next = acc[role] ?? { available: 0, total: 0 };
    next.total += 1;
    if (binding.availability_status === "available") next.available += 1;
    acc[role] = next;
    return acc;
  }, {});
  const blockedRoles = Object.entries(roleAvailability)
    .filter(([, value]) => value.total > 0 && value.available === 0)
    .map(([role]) => role);
  const latestUpgrade = db
    .prepare(
      `SELECT title
       FROM guild_upgrade_proposals
       WHERE guild_id = ? AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(guildId) as { title: string } | undefined;
  const latestJournal = db
    .prepare(
      `SELECT description
       FROM guild_accounting_journal_entries
       WHERE guild_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(guildId) as { description: string } | undefined;
  const smokeTaskCount = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM tasks
       WHERE workflow_meta_json LIKE ?
         AND workflow_meta_json LIKE '%"smoke":true%'`,
    )
    .get(`%"guildId":"${guildId}"%`) as { count: number } | undefined;
  const memoryRecords = countGuildMemories(db as any, guildId);
  const hrReviewCount = db
    .prepare("SELECT COUNT(*) AS count FROM guild_hr_reviews WHERE guild_id = ?")
    .get(guildId) as { count: number } | undefined;
  const pendingGovernanceRequests = db
    .prepare("SELECT COUNT(*) AS count FROM guild_governance_requests WHERE guild_id = ? AND status = 'pending'")
    .get(guildId) as { count: number } | undefined;
  const pendingHrRequests = pendingGovernanceRequests?.count ?? 0;

  const status =
    manifest.actors.length === 0
      ? "warming_up"
      : manifest.governance.pendingUpgrades > 0 || pendingHrRequests > 0
        ? "needs_decision"
        : manifest.accounting.netIncome < 0
          ? "watch_cost"
          : "ready";

  const bullets = [
    `${manifest.actors.length} runtime agent${manifest.actors.length === 1 ? "" : "s"} bound to this guild.`,
    `Runtime readiness: ${runtimeAvailable} available, ${runtimeLimited} limited, ${runtimeDisabled} disabled.`,
    `P&L: revenue $${manifest.accounting.revenue.toFixed(2)}, expenses $${manifest.accounting.expenses.toFixed(2)}, net $${manifest.accounting.netIncome.toFixed(2)}.`,
    `Tasks: ${manifest.tasks.planned} planned, ${manifest.tasks.inProgress} in progress, ${manifest.tasks.review} in review.`,
    `Memory: ${memoryRecords} SQLite L2 record${memoryRecords === 1 ? "" : "s"} captured for this guild.`,
    `HR: ${hrReviewCount?.count ?? 0} review${(hrReviewCount?.count ?? 0) === 1 ? "" : "s"}, ${pendingHrRequests} pending governance request${pendingHrRequests === 1 ? "" : "s"}.`,
  ];
  if (blockedRoles.length > 0) bullets.push(`Blocked roles without available runtime: ${blockedRoles.join(", ")}.`);
  if (latestUpgrade?.title) bullets.push(`Pending upgrade: ${latestUpgrade.title}.`);
  if (manifest.governance.latestAdvice) bullets.push(`SGM advice: ${manifest.governance.latestAdvice}.`);
  if (latestJournal?.description) bullets.push(`Latest journal: ${latestJournal.description}.`);

  const nextActions: GuildSgmBriefing["nextActions"] = [];
  if (manifest.actors.length === 0) {
    nextActions.push({ key: "bootstrap_runtime", label: "Bootstrap Local Ollama runtime", priority: "high" });
  }
  if (manifest.governance.pendingUpgrades > 0) {
    nextActions.push({ key: "review_upgrades", label: "Review pending upgrade proposals", priority: "high" });
  }
  if (pendingHrRequests > 0) {
    nextActions.push({ key: "review_hr_governance", label: "Review pending HR governance requests", priority: "high" });
  }
  if (blockedRoles.length > 0) {
    nextActions.push({ key: "restore_runtime", label: "Restore runtime availability for blocked roles", priority: "high" });
  } else if (runtimeLimited > 0) {
    nextActions.push({ key: "watch_runtime_limits", label: "Watch limited models and keep backup bindings ready", priority: "medium" });
  }
  if (manifest.tasks.planned > 0) {
    nextActions.push({ key: "run_planned_task", label: "Run or inspect planned Guild task smoke", priority: "medium" });
  }
  if (manifest.accounting.netIncome < 0) {
    nextActions.push({ key: "check_costs", label: "Review token costs and model pricing", priority: "medium" });
  }
  if (nextActions.length === 0) {
    nextActions.push({ key: "continue_operations", label: "Continue local operations and gather more evidence", priority: "low" });
  }
  if (memoryRecords === 0) {
    nextActions.push({ key: "seed_l2_memory", label: "Capture the first durable Guild memory", priority: "medium" });
  }

  const readiness: GuildSgmBriefing["readiness"] = [
    {
      key: "runtime",
      label: "Runtime bindings",
      status: runtimeAvailable > 0 && blockedRoles.length === 0 ? "ready" : "action_needed",
      detail:
        runtimeAvailable > 0 && blockedRoles.length === 0
          ? `${runtimeAvailable} runtime binding${runtimeAvailable === 1 ? "" : "s"} available.`
          : blockedRoles.length > 0
            ? `Blocked role${blockedRoles.length === 1 ? "" : "s"}: ${blockedRoles.join(", ")}.`
            : "Bootstrap Local Ollama runtime before running Guild tasks.",
    },
    {
      key: "limits",
      label: "AI limits",
      status: runtimeLimited > 0 ? "watch" : "ready",
      detail:
        runtimeLimited > 0
          ? `${runtimeLimited} provider/model binding${runtimeLimited === 1 ? "" : "s"} currently limited.`
          : "No active provider/model limits blocking this guild.",
    },
    {
      key: "smoke",
      label: "Scratch smoke",
      status: (smokeTaskCount?.count ?? 0) > 0 ? "ready" : "action_needed",
      detail:
        (smokeTaskCount?.count ?? 0) > 0
          ? `${smokeTaskCount?.count ?? 0} Guild smoke task${(smokeTaskCount?.count ?? 0) === 1 ? "" : "s"} staged or recorded.`
          : "Stage and run a scratch smoke task to validate the local loop.",
    },
    {
      key: "accounting",
      label: "Accounting",
      status: latestJournal ? "ready" : "watch",
      detail: latestJournal ? `Latest journal: ${latestJournal.description}.` : "Record sample revenue, credit, or token usage to seed accounting evidence.",
    },
    {
      key: "governance",
      label: "Governance",
      status: manifest.governance.pendingUpgrades > 0 ? "action_needed" : "ready",
      detail:
        manifest.governance.pendingUpgrades > 0
          ? `${manifest.governance.pendingUpgrades} upgrade proposal${manifest.governance.pendingUpgrades === 1 ? "" : "s"} awaiting decision.`
          : "No pending upgrade decision blocking operations.",
    },
    {
      key: "memory",
      label: "L2 memory",
      status: memoryRecords > 0 ? "ready" : "watch",
      detail:
        memoryRecords > 0
          ? `${memoryRecords} durable SQLite memory record${memoryRecords === 1 ? "" : "s"} available.`
          : "Capture advice, decisions, revenue context, or operating notes as durable memory.",
    },
    {
      key: "hr",
      label: "HR governance",
      status: pendingHrRequests > 0 ? "action_needed" : (hrReviewCount?.count ?? 0) > 0 ? "ready" : "watch",
      detail:
        pendingHrRequests > 0
          ? `${pendingHrRequests} HR governance request${pendingHrRequests === 1 ? "" : "s"} awaiting human decision.`
          : (hrReviewCount?.count ?? 0) > 0
            ? `${hrReviewCount?.count ?? 0} HR review${(hrReviewCount?.count ?? 0) === 1 ? "" : "s"} recorded.`
            : "Record HR reviews before allowing replacement or termination decisions.",
    },
  ];

  const headline =
    status === "warming_up"
      ? "Guild runtime is not bound yet."
      : status === "needs_decision"
        ? "Guild is ready, but SGM decisions are waiting."
        : status === "watch_cost"
          ? "Guild is running with cost pressure."
          : "Guild is ready for the next operating step.";

  return {
    guildId,
    generatedAt,
    headline,
    status,
    bullets,
    nextActions,
    readiness,
    metrics: {
      actors: manifest.actors.length,
      pendingUpgrades: manifest.governance.pendingUpgrades,
      plannedTasks: manifest.tasks.planned,
      netIncome: manifest.accounting.netIncome,
      runtimeAvailable,
      runtimeLimited,
      memoryRecords,
      hrReviews: hrReviewCount?.count ?? 0,
      pendingGovernanceRequests: pendingHrRequests,
    },
  };
}
