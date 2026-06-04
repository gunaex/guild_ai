import type { DatabaseSync } from "node:sqlite";
import { listGuildMemories, type GuildMemoryRecord } from "./memory.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildVectorMemoryStatus = {
  provider: "sqlite" | "chroma";
  enabled: boolean;
  ready: boolean;
  endpoint: string | null;
  collection: string;
  detail: string;
};

export type GuildRagMemoryResult = {
  provider: "sqlite" | "chroma";
  query: string;
  records: GuildMemoryRecord[];
  status: GuildVectorMemoryStatus;
};

type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const DEFAULT_CHROMA_URL = "http://127.0.0.1:8000";

export function chromaCollectionName(guildId: string): string {
  return `guild_ai_${guildId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export async function getGuildVectorMemoryStatus(input: {
  guildId: string;
  provider?: string | null;
  endpoint?: string | null;
  fetchImpl?: FetchLike;
}): Promise<GuildVectorMemoryStatus> {
  const provider = input.provider === "chroma" ? "chroma" : "sqlite";
  const collection = chromaCollectionName(input.guildId);
  if (provider !== "chroma") {
    return {
      provider: "sqlite",
      enabled: false,
      ready: true,
      endpoint: null,
      collection,
      detail: "SQLite L2 memory is active; Chroma L3 is disabled.",
    };
  }

  const endpoint = (input.endpoint || process.env.CHROMA_URL || DEFAULT_CHROMA_URL).replace(/\/$/, "");
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${endpoint}/api/v1/heartbeat`, { signal: AbortSignal.timeout(2500) });
    return {
      provider: "chroma",
      enabled: true,
      ready: res.ok,
      endpoint,
      collection,
      detail: res.ok ? "Chroma heartbeat responded." : `Chroma heartbeat returned HTTP ${res.status}.`,
    };
  } catch (err) {
    return {
      provider: "chroma",
      enabled: true,
      ready: false,
      endpoint,
      collection,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function sqliteKeywordSearch(db: DbLike, guildId: string, query: string, limit: number): GuildMemoryRecord[] {
  const like = `%${query.replace(/[%_]/g, " ").trim()}%`;
  if (!query.trim()) return listGuildMemories(db, { guildId, limit });
  return db
    .prepare(
      `SELECT id, guild_id, provider, namespace, content, metadata_json, embedding_ref, created_at
       FROM guild_memory_records
       WHERE guild_id = ?
         AND (content LIKE ? OR metadata_json LIKE ? OR namespace LIKE ?)
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(guildId, like, like, like, Math.max(1, Math.min(Math.floor(limit), 20))) as GuildMemoryRecord[];
}

export async function queryGuildRagMemory(input: {
  db: DbLike;
  guildId: string;
  query: string;
  limit?: number;
  provider?: string | null;
  endpoint?: string | null;
  fetchImpl?: FetchLike;
}): Promise<GuildRagMemoryResult> {
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 8), 20));
  const status = await getGuildVectorMemoryStatus({
    guildId: input.guildId,
    provider: input.provider,
    endpoint: input.endpoint,
    fetchImpl: input.fetchImpl,
  });

  // Until embeddings are configured, SQLite keyword recall remains the safe local fallback.
  return {
    provider: status.ready && status.provider === "chroma" ? "chroma" : "sqlite",
    query: input.query,
    records: sqliteKeywordSearch(input.db, input.guildId, input.query, limit),
    status,
  };
}
