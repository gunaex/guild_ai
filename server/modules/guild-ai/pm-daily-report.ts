import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { getProfitAndLossSummary } from "./accounting-journal.ts";
import { buildGuildSgmBriefing } from "./briefing.ts";
import { getLatestGuildCommunityInsight } from "./community-lounge.ts";
import type { GuildLaunchReadiness } from "./launch-readiness.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildPmDailyReportSummary = {
  guildId: string;
  reportDate: string;
  generatedAt: number;
  launchStatus: GuildLaunchReadiness["status"];
  launchScore: number;
  tasks: {
    created24h: number;
    done24h: number;
    review24h: number;
    inProgress: number;
    blocked: number;
  };
  finance: {
    revenue: number;
    expense: number;
    netIncome: number;
    tokenCost: number;
    tokens24h: number;
  };
  operations: {
    activeRuntimeBindings: number;
    activeModelLimits: number;
    pendingGovernanceRequests: number;
    openAdvice: number;
    memoryRecords: number;
    averageProductivityScore: number | null;
  };
  backup: {
    latestStatus: "succeeded" | "failed" | "none";
    latestAt: number | null;
    retentionDays: number | null;
    restoreVerified: boolean;
    restoreStatus: "verified" | "failed" | "unknown";
    backupDir: string | null;
    error: string | null;
  };
  community: {
    sessions24h: number;
    latestAt: number | null;
    latestTopic: string | null;
    latestSummary: string | null;
  };
  nextActions: string[];
};

export type GuildPmDailyReport = {
  id: string;
  guildId: string;
  reportDate: string;
  generatedAt: number;
  summary: GuildPmDailyReportSummary;
  markdown: string;
  source: "scheduler" | "manual" | "doctor";
  createdAt: number;
};

function dateKey(now: number, timeZone = "Asia/Bangkok"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function count(db: DbLike, sql: string, ...params: SQLInputValue[]): number {
  const row = db.prepare(sql).get(...params) as { count: number } | undefined;
  return row?.count ?? 0;
}

function sum(db: DbLike, sql: string, ...params: SQLInputValue[]): number {
  const row = db.prepare(sql).get(...params) as { total: number | null } | undefined;
  return Number(row?.total ?? 0);
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function buildNextActions(input: {
  launch: GuildLaunchReadiness;
  activeLimits: number;
  pendingGovernance: number;
  done24h: number;
  inProgress: number;
  netIncome: number;
  restoreVerified: boolean;
  backupStatus: "succeeded" | "failed" | "none";
  communitySessions24h: number;
}): string[] {
  const actions: string[] = [];
  if (input.launch.status !== "ready_for_today") {
    actions.push(...input.launch.nextActions.slice(0, 3));
  }
  if (input.activeLimits > 0) actions.push("Review active model limits and keep affected provider/model pairs paused until cooldown.");
  if (input.pendingGovernance > 0) actions.push("Resolve pending human governance requests before approving upgrades.");
  if (input.done24h === 0 && input.inProgress === 0) actions.push("Start one safe Guild smoke or production task to keep daily operating evidence fresh.");
  if (input.netIncome < 0) actions.push("Record service revenue or top up pricing data so P&L reflects real customer income.");
  if (input.backupStatus === "none") actions.push("Run one backup snapshot and verify restore proof before relying on local production data.");
  if (input.backupStatus === "failed" || !input.restoreVerified) actions.push("Fix backup restore proof before considering the system recoverable.");
  if (input.communitySessions24h === 0) actions.push("Start one Community Lounge break session so agents can turn fresh lessons into learning memory.");
  if (actions.length === 0) actions.push("Continue today's local trial and keep the Guild AI panel open for readiness drift.");
  return [...new Set(actions)].slice(0, 6);
}

function latestBackupStatus(db: DbLike, guildId: string): GuildPmDailyReportSummary["backup"] {
  const row = db
    .prepare(
      `SELECT status, backup_dir, retention_days, manifest_json, error, created_at
       FROM guild_backup_snapshots
       WHERE guild_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(guildId) as
    | {
        status: "succeeded" | "failed";
        backup_dir: string;
        retention_days: number;
        manifest_json: string;
        error: string | null;
        created_at: number;
      }
    | undefined;
  if (!row) {
    return {
      latestStatus: "none",
      latestAt: null,
      retentionDays: null,
      restoreVerified: false,
      restoreStatus: "unknown",
      backupDir: null,
      error: null,
    };
  }

  let restoreStatus: "verified" | "failed" | "unknown" = "unknown";
  try {
    const manifest = JSON.parse(row.manifest_json) as { restoreProof?: { status?: unknown } };
    if (manifest.restoreProof?.status === "verified" || manifest.restoreProof?.status === "failed") {
      restoreStatus = manifest.restoreProof.status;
    }
  } catch {
    restoreStatus = "unknown";
  }

  return {
    latestStatus: row.status,
    latestAt: row.created_at,
    retentionDays: row.retention_days,
    restoreVerified: row.status === "succeeded" && restoreStatus === "verified",
    restoreStatus,
    backupDir: row.backup_dir,
    error: row.error,
  };
}

function renderMarkdown(summary: GuildPmDailyReportSummary): string {
  return [
    `# Guild AI Daily PM Report - ${summary.reportDate}`,
    "",
    `Guild: ${summary.guildId}`,
    `Launch readiness: ${summary.launchStatus} (${summary.launchScore}%)`,
    "",
    "## Work",
    `- Created in last 24h: ${summary.tasks.created24h}`,
    `- Done in last 24h: ${summary.tasks.done24h}`,
    `- In review in last 24h: ${summary.tasks.review24h}`,
    `- Currently in progress: ${summary.tasks.inProgress}`,
    `- Blocked/paused: ${summary.tasks.blocked}`,
    "",
    "## Finance",
    `- Revenue: ${money(summary.finance.revenue)}`,
    `- Expense: ${money(summary.finance.expense)}`,
    `- Net income: ${money(summary.finance.netIncome)}`,
    `- Token cost: ${money(summary.finance.tokenCost)}`,
    `- Tokens in last 24h: ${summary.finance.tokens24h}`,
    "",
    "## Operations",
    `- Active runtime bindings: ${summary.operations.activeRuntimeBindings}`,
    `- Active model limits: ${summary.operations.activeModelLimits}`,
    `- Pending governance requests: ${summary.operations.pendingGovernanceRequests}`,
    `- Open advice: ${summary.operations.openAdvice}`,
    `- Memory records: ${summary.operations.memoryRecords}`,
    `- Average productivity score: ${summary.operations.averageProductivityScore ?? "-"}`,
    "",
    "## Backup",
    `- Latest snapshot: ${summary.backup.latestStatus}`,
    `- Restore proof: ${summary.backup.restoreStatus}`,
    `- Retention: ${summary.backup.retentionDays ?? "-"} day(s)`,
    `- Backup dir: ${summary.backup.backupDir ?? "-"}`,
    ...(summary.backup.error ? [`- Error: ${summary.backup.error}`] : []),
    "",
    "## Community",
    `- Lounge sessions in last 24h: ${summary.community.sessions24h}`,
    `- Latest topic: ${summary.community.latestTopic ?? "-"}`,
    `- Latest summary: ${summary.community.latestSummary ?? "-"}`,
    "",
    "## Next Actions",
    ...summary.nextActions.map((action) => `- ${action}`),
    "",
  ].join("\n");
}

function rowToReport(row: {
  id: string;
  guild_id: string;
  report_date: string;
  generated_at: number;
  summary_json: string;
  markdown: string;
  source: "scheduler" | "manual" | "doctor";
  created_at: number;
}): GuildPmDailyReport {
  return {
    id: row.id,
    guildId: row.guild_id,
    reportDate: row.report_date,
    generatedAt: row.generated_at,
    summary: JSON.parse(row.summary_json) as GuildPmDailyReportSummary,
    markdown: row.markdown,
    source: row.source,
    createdAt: row.created_at,
  };
}

export function generateGuildPmDailyReport(input: {
  db: DbLike;
  guildId: string;
  generatedAt: number;
  launch: GuildLaunchReadiness;
  source?: "scheduler" | "manual" | "doctor";
  timeZone?: string;
}): GuildPmDailyReport {
  const { db, guildId, generatedAt, launch } = input;
  const since = generatedAt - 24 * 60 * 60 * 1000;
  const reportDate = dateKey(generatedAt, input.timeZone);
  const pnl = getProfitAndLossSummary(db as DatabaseSync, guildId);
  const briefing = buildGuildSgmBriefing(db as DatabaseSync, guildId, generatedAt);
  const activeLimits = count(
    db,
    "SELECT COUNT(*) AS count FROM guild_ai_limit_events WHERE guild_id = ? AND active_until IS NOT NULL AND active_until > ?",
    guildId,
    generatedAt,
  );
  const pendingGovernance = count(
    db,
    "SELECT COUNT(*) AS count FROM guild_governance_requests WHERE guild_id = ? AND status = 'pending'",
    guildId,
  );
  const avgProductivityRow = db
    .prepare("SELECT AVG(productivity_score) AS average FROM guild_hr_reviews WHERE guild_id = ? AND review_date = ?")
    .get(guildId, reportDate) as { average: number | null } | undefined;
  const done24h = count(db, "SELECT COUNT(*) AS count FROM tasks WHERE status = 'done' AND updated_at >= ?", since);
  const inProgress = count(db, "SELECT COUNT(*) AS count FROM tasks WHERE status = 'in_progress'");
  const backup = latestBackupStatus(db, guildId);
  const community = getLatestGuildCommunityInsight(db, guildId, generatedAt);
  const summary: GuildPmDailyReportSummary = {
    guildId,
    reportDate,
    generatedAt,
    launchStatus: launch.status,
    launchScore: launch.score,
    tasks: {
      created24h: count(db, "SELECT COUNT(*) AS count FROM tasks WHERE created_at >= ?", since),
      done24h,
      review24h: count(db, "SELECT COUNT(*) AS count FROM tasks WHERE status = 'review' AND updated_at >= ?", since),
      inProgress,
      blocked: count(db, "SELECT COUNT(*) AS count FROM tasks WHERE status IN ('paused','cancelled','failed')"),
    },
    finance: {
      revenue: pnl.revenue,
      expense: pnl.expenses,
      netIncome: pnl.netIncome,
      tokenCost: sum(db, "SELECT SUM(cost_usd) AS total FROM guild_token_usage WHERE guild_id = ?", guildId),
      tokens24h: sum(db, "SELECT SUM(total_tokens) AS total FROM guild_token_usage WHERE guild_id = ? AND created_at >= ?", guildId, since),
    },
    operations: {
      activeRuntimeBindings: count(
        db,
        "SELECT COUNT(*) AS count FROM guild_runtime_bindings WHERE guild_id = ? AND status = 'active'",
        guildId,
      ),
      activeModelLimits: activeLimits,
      pendingGovernanceRequests: pendingGovernance,
      openAdvice: count(db, "SELECT COUNT(*) AS count FROM guild_human_advice WHERE guild_id = ? AND status = 'open'", guildId),
      memoryRecords: count(db, "SELECT COUNT(*) AS count FROM guild_memory_records WHERE guild_id = ?", guildId),
      averageProductivityScore:
        avgProductivityRow?.average === null || avgProductivityRow?.average === undefined
          ? null
          : Math.round(Number(avgProductivityRow.average)),
    },
    backup,
    community,
    nextActions: buildNextActions({
      launch,
      activeLimits,
      pendingGovernance,
      done24h,
      inProgress,
      netIncome: pnl.netIncome,
      restoreVerified: backup.restoreVerified,
      backupStatus: backup.latestStatus,
      communitySessions24h: community.sessions24h,
    }),
  };
  const markdown = renderMarkdown(summary);
  const id = `${guildId}-${reportDate}`;
  const source = input.source ?? "scheduler";

  db.prepare(
    `INSERT INTO guild_pm_daily_reports (id, guild_id, report_date, generated_at, summary_json, markdown, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, report_date) DO UPDATE SET
       id = excluded.id,
       generated_at = excluded.generated_at,
       summary_json = excluded.summary_json,
       markdown = excluded.markdown,
       source = excluded.source`,
  ).run(id, guildId, reportDate, generatedAt, JSON.stringify(summary), markdown, source, generatedAt);

  return { id, guildId, reportDate, generatedAt, summary, markdown, source, createdAt: generatedAt };
}

export function getLatestGuildPmDailyReport(db: DbLike, guildId: string): GuildPmDailyReport | null {
  const row = db
    .prepare(
      `SELECT * FROM guild_pm_daily_reports
       WHERE guild_id = ?
       ORDER BY report_date DESC, generated_at DESC
       LIMIT 1`,
    )
    .get(guildId) as Parameters<typeof rowToReport>[0] | undefined;
  return row ? rowToReport(row) : null;
}

export function listGuildPmDailyReports(db: DbLike, guildId: string, limit = 14): GuildPmDailyReport[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 60);
  return (
    db
      .prepare(
        `SELECT * FROM guild_pm_daily_reports
         WHERE guild_id = ?
         ORDER BY report_date DESC, generated_at DESC
         LIMIT ?`,
      )
      .all(guildId, safeLimit) as Array<Parameters<typeof rowToReport>[0]>
  ).map(rowToReport);
}

export function msUntilNextDailyPmReport(now: number, hour = 8, minute = 0, timeZone = "Asia/Bangkok"): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(now));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localTodayUtc = Date.UTC(Number(lookup.year), Number(lookup.month) - 1, Number(lookup.day), hour, minute, 0, 0);
  const localNowUtc = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second),
    0,
  );
  const targetLocalUtc = localNowUtc < localTodayUtc ? localTodayUtc : localTodayUtc + 24 * 60 * 60 * 1000;
  return Math.max(1_000, targetLocalUtc - localNowUtc);
}
