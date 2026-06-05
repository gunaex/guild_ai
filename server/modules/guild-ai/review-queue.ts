import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildReviewType =
  | "self_improvement"
  | "hr_governance"
  | "memory_quality"
  | "policy_change"
  | "prompt_change"
  | "budget_exception"
  | "security_exception"
  | "accounting_adjustment"
  | "eval_regression"
  | "manual";

export type GuildReviewPriority = "low" | "normal" | "high" | "urgent";
export type GuildReviewStatus = "pending" | "in_review" | "approved" | "rejected" | "needs_info" | "cancelled";

export type GuildReviewQueueItem = {
  id: string;
  guild_id: string;
  review_type: GuildReviewType;
  title: string;
  description: string;
  source_table: string | null;
  source_id: string | null;
  priority: GuildReviewPriority;
  status: GuildReviewStatus;
  requested_by: string | null;
  assigned_to: string | null;
  decision: string | null;
  decision_reason: string | null;
  evidence_json: string;
  created_at: number;
  updated_at: number;
  decided_at: number | null;
};

const reviewTypes = new Set<GuildReviewType>([
  "self_improvement",
  "hr_governance",
  "memory_quality",
  "policy_change",
  "prompt_change",
  "budget_exception",
  "security_exception",
  "accounting_adjustment",
  "eval_regression",
  "manual",
]);
const priorities = new Set<GuildReviewPriority>(["low", "normal", "high", "urgent"]);
const decisions = new Set<GuildReviewStatus>(["approved", "rejected", "needs_info"]);

export function isGuildReviewType(value: string): value is GuildReviewType {
  return reviewTypes.has(value as GuildReviewType);
}

export function isGuildReviewPriority(value: string): value is GuildReviewPriority {
  return priorities.has(value as GuildReviewPriority);
}

export function createGuildReviewQueueItem(
  db: DbLike,
  input: {
    guildId: string;
    reviewType: GuildReviewType;
    title: string;
    description: string;
    sourceTable?: string | null;
    sourceId?: string | null;
    priority?: GuildReviewPriority;
    requestedBy?: string | null;
    assignedTo?: string | null;
    evidence?: Record<string, unknown>;
    now: number;
  },
): GuildReviewQueueItem {
  const title = input.title.trim();
  const description = input.description.trim();
  if (!input.guildId.trim()) throw new Error("guildId is required.");
  if (!title) throw new Error("review title is required.");
  if (!description) throw new Error("review description is required.");
  if (!isGuildReviewType(input.reviewType)) throw new Error("invalid review type.");
  const priority = input.priority ?? "normal";
  if (!isGuildReviewPriority(priority)) throw new Error("invalid review priority.");
  const id = randomUUID();
  db.prepare(
    `INSERT INTO guild_review_queue (
      id, guild_id, review_type, title, description, source_table, source_id, priority,
      status, requested_by, assigned_to, evidence_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.guildId,
    input.reviewType,
    title,
    description,
    input.sourceTable ?? null,
    input.sourceId ?? null,
    priority,
    input.requestedBy ?? null,
    input.assignedTo ?? null,
    JSON.stringify(input.evidence ?? {}),
    input.now,
    input.now,
  );
  return db.prepare("SELECT * FROM guild_review_queue WHERE id = ?").get(id) as GuildReviewQueueItem;
}

export function listGuildReviewQueue(
  db: DbLike,
  input: { guildId?: string | null; status?: GuildReviewStatus | null; reviewType?: GuildReviewType | null; limit?: number },
): GuildReviewQueueItem[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (input.guildId) {
    clauses.push("guild_id = ?");
    params.push(input.guildId);
  }
  if (input.status) {
    clauses.push("status = ?");
    params.push(input.status);
  }
  if (input.reviewType) {
    clauses.push("review_type = ?");
    params.push(input.reviewType);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 50), 100));
  params.push(limit);
  return db
    .prepare(
      `SELECT * FROM guild_review_queue
       ${where}
       ORDER BY
         CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
         created_at DESC
       LIMIT ?`,
    )
    .all(...params) as GuildReviewQueueItem[];
}

export function decideGuildReviewQueueItem(
  db: DbLike,
  input: { id: string; decision: "approved" | "rejected" | "needs_info"; reason?: string | null; decidedBy?: string | null; now: number },
): GuildReviewQueueItem {
  if (!decisions.has(input.decision)) throw new Error("invalid review decision.");
  const existing = db.prepare("SELECT * FROM guild_review_queue WHERE id = ?").get(input.id) as GuildReviewQueueItem | undefined;
  if (!existing) throw new Error("review item not found.");
  if (!["pending", "in_review", "needs_info"].includes(existing.status)) throw new Error("review item is already closed.");
  db.prepare(
    `UPDATE guild_review_queue
     SET status = ?, decision = ?, decision_reason = ?, assigned_to = COALESCE(?, assigned_to),
         updated_at = ?, decided_at = ?
     WHERE id = ?`,
  ).run(input.decision, input.decision, input.reason ?? null, input.decidedBy ?? null, input.now, input.now, input.id);
  return db.prepare("SELECT * FROM guild_review_queue WHERE id = ?").get(input.id) as GuildReviewQueueItem;
}

export function cancelGuildReviewQueueItem(
  db: DbLike,
  input: { id: string; reason?: string | null; now: number },
): GuildReviewQueueItem {
  const existing = db.prepare("SELECT * FROM guild_review_queue WHERE id = ?").get(input.id) as GuildReviewQueueItem | undefined;
  if (!existing) throw new Error("review item not found.");
  db.prepare(
    `UPDATE guild_review_queue
     SET status = 'cancelled', decision = 'cancelled', decision_reason = ?, updated_at = ?, decided_at = ?
     WHERE id = ?`,
  ).run(input.reason ?? null, input.now, input.now, input.id);
  return db.prepare("SELECT * FROM guild_review_queue WHERE id = ?").get(input.id) as GuildReviewQueueItem;
}
