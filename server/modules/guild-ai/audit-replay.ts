import type { DatabaseSync } from "node:sqlite";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildAuditReplayEvent = {
  ts: number;
  source: "task" | "task_log" | "journal" | "limit" | "hr" | "memory" | "governance";
  title: string;
  detail: string;
  refId: string | number | null;
};

export type GuildAuditReplay = {
  guildId: string;
  generatedAt: number;
  events: GuildAuditReplayEvent[];
};

function rows<T>(db: DbLike, sql: string, ...params: Array<string | number>): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function buildGuildAuditReplay(
  db: DbLike,
  input: { guildId: string; generatedAt: number; since?: number; limit?: number },
): GuildAuditReplay {
  const since = input.since ?? input.generatedAt - 7 * 24 * 60 * 60 * 1000;
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 80), 200));
  const guildLike = `%"guildId":"${input.guildId}"%`;
  const events: GuildAuditReplayEvent[] = [];

  events.push(
    ...rows<{
      id: string;
      title: string;
      status: string;
      assigned_agent_id: string | null;
      updated_at: number;
    }>(
      db,
      `SELECT id, title, status, assigned_agent_id, updated_at
       FROM tasks
       WHERE updated_at >= ?
         AND (workflow_meta_json LIKE ? OR id IN (
           SELECT task_id FROM task_logs WHERE message LIKE ? AND created_at >= ?
         ))
       ORDER BY updated_at DESC
       LIMIT ?`,
      since,
      guildLike,
      `%${input.guildId}%`,
      since,
      limit,
    ).map((task) => ({
      ts: task.updated_at,
      source: "task" as const,
      title: `Task ${task.status}: ${task.title}`,
      detail: `assigned=${task.assigned_agent_id ?? "none"}`,
      refId: task.id,
    })),
  );

  events.push(
    ...rows<{ id: number; task_id: string | null; kind: string; message: string; created_at: number }>(
      db,
      `SELECT id, task_id, kind, message, created_at
       FROM task_logs
       WHERE created_at >= ? AND (message LIKE ? OR task_id IN (
         SELECT id FROM tasks WHERE workflow_meta_json LIKE ?
       ))
       ORDER BY created_at DESC
       LIMIT ?`,
      since,
      `%${input.guildId}%`,
      guildLike,
      limit,
    ).map((log) => ({
      ts: log.created_at,
      source: "task_log" as const,
      title: `Task log: ${log.kind}`,
      detail: log.message.slice(0, 240),
      refId: log.task_id ?? log.id,
    })),
  );

  events.push(
    ...rows<{ id: string; description: string; source_type: string; created_at: number }>(
      db,
      `SELECT id, description, source_type, created_at
       FROM guild_accounting_journal_entries
       WHERE guild_id = ? AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
      input.guildId,
      since,
      limit,
    ).map((entry) => ({
      ts: entry.created_at,
      source: "journal" as const,
      title: `Journal: ${entry.source_type}`,
      detail: entry.description,
      refId: entry.id,
    })),
  );

  events.push(
    ...rows<{ id: number; provider: string; model: string; message: string; created_at: number }>(
      db,
      `SELECT id, provider, model, message, created_at
       FROM guild_ai_limit_events
       WHERE guild_id = ? AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
      input.guildId,
      since,
      limit,
    ).map((event) => ({
      ts: event.created_at,
      source: "limit" as const,
      title: `Limit: ${event.provider}/${event.model}`,
      detail: event.message,
      refId: event.id,
    })),
  );

  events.push(
    ...rows<{ id: number; agent_id: string; productivity_score: number; scoring_source: string; created_at: number }>(
      db,
      `SELECT id, agent_id, productivity_score, scoring_source, created_at
       FROM guild_hr_reviews
       WHERE guild_id = ? AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
      input.guildId,
      since,
      limit,
    ).map((review) => ({
      ts: review.created_at,
      source: "hr" as const,
      title: `HR score: ${review.agent_id}`,
      detail: `${review.productivity_score} via ${review.scoring_source}`,
      refId: review.id,
    })),
  );

  events.push(
    ...rows<{ id: string; namespace: string; content: string; created_at: number }>(
      db,
      `SELECT id, namespace, content, created_at
       FROM guild_memory_records
       WHERE guild_id = ? AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
      input.guildId,
      since,
      limit,
    ).map((memory) => ({
      ts: memory.created_at,
      source: "memory" as const,
      title: `Memory: ${memory.namespace}`,
      detail: memory.content.slice(0, 240),
      refId: memory.id,
    })),
  );

  events.push(
    ...rows<{ id: string; agent_id: string; request_type: string; status: string; reason: string; created_at: number }>(
      db,
      `SELECT id, agent_id, request_type, status, reason, created_at
       FROM guild_governance_requests
       WHERE guild_id = ? AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
      input.guildId,
      since,
      limit,
    ).map((request) => ({
      ts: request.created_at,
      source: "governance" as const,
      title: `Governance ${request.status}: ${request.request_type}`,
      detail: `${request.agent_id}: ${request.reason}`,
      refId: request.id,
    })),
  );

  events.sort((a, b) => b.ts - a.ts || String(b.refId ?? "").localeCompare(String(a.refId ?? "")));
  return { guildId: input.guildId, generatedAt: input.generatedAt, events: events.slice(0, limit) };
}
