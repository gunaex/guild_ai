import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { buildGuildBudgetGuardStatus } from "./budget-guard.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildWorkerQueueItem = {
  id: string;
  guild_id: string;
  task_id: string | null;
  title: string;
  payload_json: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  priority: number;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  run_after: number | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
  updated_at: number;
};

export type GuildWorkerQueueStatus = {
  guildId: string;
  generatedAt: number;
  counts: Record<GuildWorkerQueueItem["status"], number>;
  nextItems: GuildWorkerQueueItem[];
};

export function enqueueGuildWorkerJob(
  db: DbLike,
  input: {
    guildId: string;
    title: string;
    taskId?: string | null;
    payload?: Record<string, unknown>;
    priority?: number;
    maxAttempts?: number;
    runAfter?: number | null;
    now: number;
  },
): GuildWorkerQueueItem {
  const id = randomUUID();
  const title = input.title.trim();
  if (!title) throw new Error("title is required.");
  const priority = Math.max(1, Math.min(5, Math.floor(input.priority ?? 3)));
  const maxAttempts = Math.max(1, Math.min(10, Math.floor(input.maxAttempts ?? 3)));
  db.prepare(
    `INSERT INTO guild_worker_queue (
      id, guild_id, task_id, title, payload_json, status, priority, attempts, max_attempts, run_after, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'queued', ?, 0, ?, ?, ?, ?)`,
  ).run(
    id,
    input.guildId,
    input.taskId ?? null,
    title,
    JSON.stringify(input.payload ?? {}),
    priority,
    maxAttempts,
    input.runAfter ?? null,
    input.now,
    input.now,
  );
  return db.prepare("SELECT * FROM guild_worker_queue WHERE id = ?").get(id) as GuildWorkerQueueItem;
}

export function listGuildWorkerQueue(db: DbLike, guildId: string, limit = 20): GuildWorkerQueueItem[] {
  return db
    .prepare(
      `SELECT *
       FROM guild_worker_queue
       WHERE guild_id = ?
       ORDER BY
         CASE status
           WHEN 'running' THEN 0
           WHEN 'queued' THEN 1
           WHEN 'failed' THEN 2
           WHEN 'succeeded' THEN 3
           ELSE 4
         END,
         priority ASC,
         created_at ASC
       LIMIT ?`,
    )
    .all(guildId, Math.max(1, Math.min(100, Math.floor(limit)))) as GuildWorkerQueueItem[];
}

export function buildGuildWorkerQueueStatus(db: DbLike, guildId: string, generatedAt: number): GuildWorkerQueueStatus {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS count
       FROM guild_worker_queue
       WHERE guild_id = ?
       GROUP BY status`,
    )
    .all(guildId) as Array<{ status: GuildWorkerQueueItem["status"]; count: number }>;
  const counts: GuildWorkerQueueStatus["counts"] = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const row of rows) counts[row.status] = Number(row.count);
  return {
    guildId,
    generatedAt,
    counts,
    nextItems: listGuildWorkerQueue(db, guildId, 10),
  };
}

export function processNextGuildWorkerQueueItem(
  db: DbLike,
  input: { guildId: string; now: number },
): { ok: boolean; item: GuildWorkerQueueItem | null; reason?: string } {
  const budget = buildGuildBudgetGuardStatus(db, input.guildId, input.now);
  if (budget.verdict === "blocked") {
    return { ok: false, item: null, reason: "budget_blocked" };
  }

  const item = db
    .prepare(
      `SELECT *
       FROM guild_worker_queue
       WHERE guild_id = ?
         AND status = 'queued'
         AND (run_after IS NULL OR run_after <= ?)
       ORDER BY priority ASC, created_at ASC
       LIMIT 1`,
    )
    .get(input.guildId, input.now) as GuildWorkerQueueItem | undefined;
  if (!item) return { ok: true, item: null, reason: "empty" };

  db.prepare(
    `UPDATE guild_worker_queue
     SET status = 'running', attempts = attempts + 1, started_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(input.now, input.now, item.id);

  db.prepare(
    `UPDATE guild_worker_queue
     SET status = 'succeeded', finished_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(input.now, input.now, item.id);

  return {
    ok: true,
    item: db.prepare("SELECT * FROM guild_worker_queue WHERE id = ?").get(item.id) as GuildWorkerQueueItem,
  };
}
