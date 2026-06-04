type DbLike = {
  prepare: (sql: string) => {
    get: (...args: any[]) => unknown;
    all: (...args: any[]) => unknown[];
    run: (...args: any[]) => unknown;
  };
};

export type GuildAiLimitType = "rate_limit" | "quota_exceeded" | "billing" | "unknown";

export type GuildAiLimitCheck = {
  limited: boolean;
  event?: {
    id: number;
    guildId: string | null;
    agentId: string | null;
    apiProviderId: string;
    provider: string;
    model: string;
    limitType: GuildAiLimitType;
    statusCode: number | null;
    message: string;
    retryAfterMs: number | null;
    activeUntil: number | null;
    recoveredAt: number | null;
    createdAt: number;
  };
};

export function classifyAiLimit(statusCode: number, message: string): GuildAiLimitType | null {
  const lower = message.toLowerCase();
  if (statusCode === 429 || lower.includes("rate limit") || lower.includes("too many requests")) return "rate_limit";
  if (lower.includes("quota") || lower.includes("insufficient_quota") || lower.includes("resource_exhausted")) {
    return "quota_exceeded";
  }
  if (statusCode === 402 || lower.includes("billing") || lower.includes("payment required") || lower.includes("credits")) {
    return "billing";
  }
  return null;
}

export function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.trunc(seconds * 1000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - Date.now());
}

export function getActiveAiLimit(
  db: DbLike,
  input: { apiProviderId: string; model: string; now?: number },
): GuildAiLimitCheck {
  const now = input.now ?? Date.now();
  reconcileExpiredAiLimits(db, now);
  let row: GuildAiLimitCheck["event"] | undefined;
  try {
    row = db
      .prepare(
        `SELECT
          id,
          guild_id AS guildId,
          agent_id AS agentId,
          api_provider_id AS apiProviderId,
          provider,
          model,
          limit_type AS limitType,
          status_code AS statusCode,
          message,
          retry_after_ms AS retryAfterMs,
          active_until AS activeUntil,
          recovered_at AS recoveredAt,
          created_at AS createdAt
         FROM guild_ai_limit_events
         WHERE api_provider_id = ?
           AND model = ?
           AND active_until IS NOT NULL
           AND active_until > ?
         ORDER BY active_until DESC, created_at DESC
         LIMIT 1`,
      )
      .get(input.apiProviderId, input.model, now) as GuildAiLimitCheck["event"] | undefined;
  } catch {
    return { limited: false };
  }

  return row ? { limited: true, event: row } : { limited: false };
}

export function reconcileExpiredAiLimits(db: DbLike, now = Date.now()): void {
  try {
    db.prepare(
      `UPDATE guild_ai_limit_events
       SET recovered_at = ?
       WHERE recovered_at IS NULL
         AND active_until IS NOT NULL
         AND active_until <= ?`,
    ).run(now, now);
  } catch {
    /* table may be absent in narrow unit-test schemas */
  }
}

export function recordAiLimitEvent(
  db: DbLike,
  input: {
    guildId?: string | null;
    agentId?: string | null;
    apiProviderId: string;
    provider: string;
    model: string;
    limitType: GuildAiLimitType;
    statusCode?: number | null;
    message: string;
    retryAfterMs?: number | null;
    activeUntil?: number | null;
    sourceType?: string;
    sourceId?: string | null;
    createdAt?: number;
  },
): number {
  const createdAt = input.createdAt ?? Date.now();
  const retryAfterMs = input.retryAfterMs ?? null;
  const activeUntil =
    input.activeUntil ?? (retryAfterMs && retryAfterMs > 0 ? createdAt + retryAfterMs : createdAt + 15 * 60 * 1000);
  const result = db
    .prepare(
      `INSERT INTO guild_ai_limit_events (
        guild_id, agent_id, api_provider_id, provider, model, limit_type, status_code,
        message, retry_after_ms, active_until, source_type, source_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.guildId ?? null,
      input.agentId ?? null,
      input.apiProviderId,
      input.provider,
      input.model,
      input.limitType,
      input.statusCode ?? null,
      input.message.slice(0, 2000),
      retryAfterMs,
      activeUntil,
      input.sourceType ?? "api_provider",
      input.sourceId ?? null,
      createdAt,
    ) as { lastInsertRowid?: number | bigint };
  return Number(result.lastInsertRowid ?? 0);
}

export function listAiLimitEvents(db: DbLike, guildId: string, limit = 50): unknown[] {
  reconcileExpiredAiLimits(db);
  return db
    .prepare(
      `SELECT
        id,
        guild_id AS guildId,
        agent_id AS agentId,
        api_provider_id AS apiProviderId,
        provider,
        model,
        limit_type AS limitType,
        status_code AS statusCode,
        message,
        retry_after_ms AS retryAfterMs,
        active_until AS activeUntil,
        recovered_at AS recoveredAt,
        source_type AS sourceType,
        source_id AS sourceId,
        created_at AS createdAt
       FROM guild_ai_limit_events
       WHERE guild_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(guildId, Math.max(1, Math.min(200, Math.trunc(limit))));
}
