import type { DatabaseSync } from "node:sqlite";
import { recordGuildHrReview, type GuildGovernanceRequest, type GuildHrReview } from "./hr-governance.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildProductivityScoreEvidence = {
  guildAgentId: string;
  runtimeAgentId: string | null;
  roleKey: string;
  displayName: string;
  reviewDate: string;
  windowStart: number;
  windowEnd: number;
  tasksAssigned: number;
  tasksDone: number;
  tasksInReview: number;
  tasksInProgress: number;
  tasksCancelled: number;
  qaPassSignals: number;
  reworkSignals: number;
  activeLimitEvents: number;
  tokenCostUsd: number;
  scoreBreakdown: Array<{ label: string; points: number }>;
};

export type GuildProductivityScoreResult = {
  review: GuildHrReview;
  governanceRequest: GuildGovernanceRequest | null;
  productivityFloor: number;
  evidence: GuildProductivityScoreEvidence;
};

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 100) / 100);
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function count(db: DbLike, sql: string, ...params: Array<string | number | null>): number {
  const row = db.prepare(sql).get(...params) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

function sum(db: DbLike, sql: string, ...params: Array<string | number | null>): number {
  const row = db.prepare(sql).get(...params) as { total: number | null } | undefined;
  return Number(row?.total ?? 0);
}

function scoreFromEvidence(evidence: Omit<GuildProductivityScoreEvidence, "scoreBreakdown">): {
  score: number;
  breakdown: GuildProductivityScoreEvidence["scoreBreakdown"];
} {
  const breakdown: GuildProductivityScoreEvidence["scoreBreakdown"] = [{ label: "base operating readiness", points: 70 }];
  if (evidence.runtimeAgentId) breakdown.push({ label: "runtime binding active", points: 5 });
  breakdown.push({ label: "completed tasks", points: Math.min(18, evidence.tasksDone * 9) });
  breakdown.push({ label: "review progress", points: Math.min(8, evidence.tasksInReview * 4) });
  breakdown.push({ label: "QA pass signals", points: Math.min(10, evidence.qaPassSignals * 5) });
  breakdown.push({ label: "in-progress load", points: -Math.min(8, evidence.tasksInProgress * 4) });
  breakdown.push({ label: "cancelled tasks", points: -Math.min(20, evidence.tasksCancelled * 10) });
  breakdown.push({ label: "rework signals", points: -Math.min(18, evidence.reworkSignals * 6) });
  breakdown.push({ label: "active model limits", points: -Math.min(20, evidence.activeLimitEvents * 10) });
  if (evidence.tokenCostUsd > 1) breakdown.push({ label: "token cost pressure", points: -Math.min(12, Math.ceil(evidence.tokenCostUsd)) });
  const total = breakdown.reduce((acc, item) => acc + item.points, 0);
  return { score: clampScore(total), breakdown };
}

export function scoreGuildAgentProductivity(
  db: DbLike,
  input: { guildId: string; guildAgentId: string; generatedAt: number; reviewDate?: string },
): GuildProductivityScoreResult {
  const guildId = input.guildId.trim();
  const guildAgentId = input.guildAgentId.trim();
  const generatedAt = input.generatedAt;
  const reviewDate = input.reviewDate?.trim() || isoDate(generatedAt);
  const windowStart = generatedAt - 24 * 60 * 60 * 1000;

  const role = db
    .prepare(
      `SELECT r.agent_id AS guildAgentId, r.role_key AS roleKey, r.display_name AS displayName,
              b.runtime_agent_id AS runtimeAgentId, b.api_provider_id AS apiProviderId, b.model AS model
       FROM guild_agent_roles r
       LEFT JOIN guild_runtime_bindings b
         ON b.guild_id = r.guild_id AND b.guild_agent_id = r.agent_id AND b.status = 'active'
       WHERE r.guild_id = ? AND r.agent_id = ?`,
    )
    .get(guildId, guildAgentId) as
    | {
        guildAgentId: string;
        roleKey: string;
        displayName: string;
        runtimeAgentId: string | null;
        apiProviderId: string | null;
        model: string | null;
      }
    | undefined;
  if (!role) throw new Error("Guild agent role not found.");

  const runtimeAgentId = role.runtimeAgentId ?? null;
  const assignedParam = runtimeAgentId ?? "__no_runtime_agent__";
  const tasksAssigned = count(
    db,
    "SELECT COUNT(*) AS count FROM tasks WHERE assigned_agent_id = ? AND updated_at >= ? AND updated_at <= ?",
    assignedParam,
    windowStart,
    generatedAt,
  );
  const tasksDone = count(
    db,
    "SELECT COUNT(*) AS count FROM tasks WHERE assigned_agent_id = ? AND status = 'done' AND updated_at >= ? AND updated_at <= ?",
    assignedParam,
    windowStart,
    generatedAt,
  );
  const tasksInReview = count(
    db,
    "SELECT COUNT(*) AS count FROM tasks WHERE assigned_agent_id = ? AND status = 'review' AND updated_at >= ? AND updated_at <= ?",
    assignedParam,
    windowStart,
    generatedAt,
  );
  const tasksInProgress = count(
    db,
    "SELECT COUNT(*) AS count FROM tasks WHERE assigned_agent_id = ? AND status = 'in_progress'",
    assignedParam,
  );
  const tasksCancelled = count(
    db,
    "SELECT COUNT(*) AS count FROM tasks WHERE assigned_agent_id = ? AND status = 'cancelled' AND updated_at >= ? AND updated_at <= ?",
    assignedParam,
    windowStart,
    generatedAt,
  );
  const qaPassSignals = count(
    db,
    `SELECT COUNT(*) AS count
     FROM task_logs l
     JOIN tasks t ON t.id = l.task_id
     WHERE t.assigned_agent_id = ?
       AND l.created_at >= ?
       AND l.created_at <= ?
       AND (LOWER(l.message) LIKE '%qa_pass%' OR LOWER(l.message) LIKE '%qa pass%')`,
    assignedParam,
    windowStart,
    generatedAt,
  );
  const reworkSignals = count(
    db,
    `SELECT COUNT(*) AS count
     FROM task_logs l
     JOIN tasks t ON t.id = l.task_id
     WHERE t.assigned_agent_id = ?
       AND l.created_at >= ?
       AND l.created_at <= ?
       AND (LOWER(l.message) LIKE '%qa_fail%' OR LOWER(l.message) LIKE '%revision%' OR LOWER(l.message) LIKE '%rework%')`,
    assignedParam,
    windowStart,
    generatedAt,
  );
  const tokenCostUsd = roundMoney(
    sum(
      db,
      "SELECT SUM(cost_usd) AS total FROM guild_token_usage WHERE guild_id = ? AND agent_id = ? AND created_at >= ? AND created_at <= ?",
      guildId,
      guildAgentId,
      windowStart,
      generatedAt,
    ),
  );
  const activeLimitEvents =
    role.apiProviderId && role.model
      ? count(
          db,
          `SELECT COUNT(*) AS count
           FROM guild_ai_limit_events
           WHERE guild_id = ?
             AND api_provider_id = ?
             AND model = ?
             AND active_until IS NOT NULL
             AND active_until > ?`,
          guildId,
          role.apiProviderId,
          role.model,
          generatedAt,
        )
      : 0;

  const evidenceBase = {
    guildAgentId,
    runtimeAgentId,
    roleKey: role.roleKey,
    displayName: role.displayName,
    reviewDate,
    windowStart,
    windowEnd: generatedAt,
    tasksAssigned,
    tasksDone,
    tasksInReview,
    tasksInProgress,
    tasksCancelled,
    qaPassSignals,
    reworkSignals,
    activeLimitEvents,
    tokenCostUsd,
  };
  const { score, breakdown } = scoreFromEvidence(evidenceBase);
  const evidence: GuildProductivityScoreEvidence = { ...evidenceBase, scoreBreakdown: breakdown };
  const result = recordGuildHrReview(db, {
    guildId,
    agentId: guildAgentId,
    productivityScore: score,
    tokenCostUsd,
    reviewDate,
    scoringSource: "auto",
    evidence,
    createdAt: generatedAt,
  });
  return { ...result, evidence };
}

export function scoreGuildProductivityForAllAgents(
  db: DbLike,
  input: { guildId: string; generatedAt: number; reviewDate?: string },
): GuildProductivityScoreResult[] {
  const roles = db
    .prepare("SELECT agent_id AS agentId FROM guild_agent_roles WHERE guild_id = ? ORDER BY role_key ASC, agent_id ASC")
    .all(input.guildId) as Array<{ agentId: string }>;
  return roles.map((role) =>
    scoreGuildAgentProductivity(db, {
      guildId: input.guildId,
      guildAgentId: role.agentId,
      generatedAt: input.generatedAt,
      reviewDate: input.reviewDate,
    }),
  );
}
