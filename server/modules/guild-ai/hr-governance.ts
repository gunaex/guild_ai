import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildHrReview = {
  id: number;
  guild_id: string;
  agent_id: string;
  productivity_score: number;
  token_cost_usd: number;
  review_date: string;
  created_at: number;
};

export type GuildGovernanceRequest = {
  id: string;
  guild_id: string;
  agent_id: string;
  request_type: "termination" | "budget_override" | "human_decision" | "capability_upgrade";
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string;
  evidence_json: string;
  decided_at: number | null;
  created_at: number;
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100) / 100;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function recordGuildHrReview(
  db: DbLike,
  input: {
    guildId: string;
    agentId: string;
    productivityScore: number;
    tokenCostUsd?: number;
    reviewDate?: string;
    createdAt: number;
  },
): { review: GuildHrReview; governanceRequest: GuildGovernanceRequest | null; productivityFloor: number } {
  const guildId = input.guildId.trim();
  const agentId = input.agentId.trim();
  if (!guildId || !agentId) throw new Error("guildId and agentId are required.");

  const productivityScore = clampScore(input.productivityScore);
  const tokenCostUsd = roundMoney(input.tokenCostUsd ?? 0);
  const reviewDate = input.reviewDate?.trim() || isoDate(input.createdAt);
  const role = db
    .prepare(
      `SELECT display_name, role_key, COALESCE(productivity_floor, 60) AS productivity_floor
       FROM guild_agent_roles
       WHERE guild_id = ? AND agent_id = ?`,
    )
    .get(guildId, agentId) as { display_name: string; role_key: string; productivity_floor: number } | undefined;
  const productivityFloor = Number(role?.productivity_floor ?? 60);

  const result = db
    .prepare(
      `INSERT INTO guild_hr_reviews (
        guild_id, agent_id, productivity_score, token_cost_usd, review_date, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, agent_id, review_date)
      DO UPDATE SET
        productivity_score = excluded.productivity_score,
        token_cost_usd = excluded.token_cost_usd,
        created_at = excluded.created_at`,
    )
    .run(guildId, agentId, productivityScore, tokenCostUsd, reviewDate, input.createdAt);

  const review = db
    .prepare(
      `SELECT id, guild_id, agent_id, productivity_score, token_cost_usd, review_date, created_at
       FROM guild_hr_reviews
       WHERE guild_id = ? AND agent_id = ? AND review_date = ?`,
    )
    .get(guildId, agentId, reviewDate) as GuildHrReview;

  const shouldRequestHumanDecision = productivityScore < productivityFloor;
  if (!shouldRequestHumanDecision) {
    return { review, governanceRequest: null, productivityFloor };
  }

  const existing = db
    .prepare(
      `SELECT id, guild_id, agent_id, request_type, status, reason, evidence_json, decided_at, created_at
       FROM guild_governance_requests
       WHERE guild_id = ? AND agent_id = ? AND request_type = 'termination' AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(guildId, agentId) as GuildGovernanceRequest | undefined;
  if (existing) return { review, governanceRequest: existing, productivityFloor };

  const requestId = randomUUID();
  const reason = `${role?.display_name ?? agentId} scored ${productivityScore}, below HR floor ${productivityFloor}. Human approval is required before termination or replacement.`;
  const evidence = JSON.stringify({
    reviewId: review.id,
    roleKey: role?.role_key ?? null,
    productivityScore,
    productivityFloor,
    tokenCostUsd,
    reviewDate,
  });
  db.prepare(
    `INSERT INTO guild_governance_requests (
      id, guild_id, agent_id, request_type, status, reason, evidence_json, created_at
    ) VALUES (?, ?, ?, 'termination', 'pending', ?, ?, ?)`,
  ).run(requestId, guildId, agentId, reason, evidence, input.createdAt);

  const governanceRequest = db
    .prepare(
      `SELECT id, guild_id, agent_id, request_type, status, reason, evidence_json, decided_at, created_at
       FROM guild_governance_requests
       WHERE id = ?`,
    )
    .get(requestId) as GuildGovernanceRequest;

  return { review, governanceRequest, productivityFloor };
}

export function listGuildHrReviews(db: DbLike, guildId: string, limit = 20): GuildHrReview[] {
  return db
    .prepare(
      `SELECT id, guild_id, agent_id, productivity_score, token_cost_usd, review_date, created_at
       FROM guild_hr_reviews
       WHERE guild_id = ?
       ORDER BY review_date DESC, created_at DESC
       LIMIT ?`,
    )
    .all(guildId, Math.max(1, Math.min(Math.floor(limit), 100))) as GuildHrReview[];
}

export function listGuildGovernanceRequests(db: DbLike, guildId: string, limit = 20): GuildGovernanceRequest[] {
  return db
    .prepare(
      `SELECT id, guild_id, agent_id, request_type, status, reason, evidence_json, decided_at, created_at
       FROM guild_governance_requests
       WHERE guild_id = ?
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
       LIMIT ?`,
    )
    .all(guildId, Math.max(1, Math.min(Math.floor(limit), 100))) as GuildGovernanceRequest[];
}

export function decideGuildGovernanceRequest(
  db: DbLike,
  input: { requestId: string; decision: "approved" | "rejected" | "cancelled"; decidedAt: number },
): GuildGovernanceRequest {
  const result = db
    .prepare("UPDATE guild_governance_requests SET status = ?, decided_at = ? WHERE id = ?")
    .run(input.decision, input.decidedAt, input.requestId);
  if (result.changes === 0) throw new Error("Governance request not found.");

  return db
    .prepare(
      `SELECT id, guild_id, agent_id, request_type, status, reason, evidence_json, decided_at, created_at
       FROM guild_governance_requests
       WHERE id = ?`,
    )
    .get(input.requestId) as GuildGovernanceRequest;
}
