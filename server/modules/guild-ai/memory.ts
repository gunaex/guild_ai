import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildMemoryNamespace = "operations" | "governance" | "accounting" | "runtime" | "customer" | "learning";

export type GuildMemoryRecord = {
  id: string;
  guild_id: string;
  provider: "sqlite" | "chroma";
  namespace: GuildMemoryNamespace;
  content: string;
  metadata_json: string;
  embedding_ref: string | null;
  created_at: number;
};

export type GuildMemoryInput = {
  guildId: string;
  namespace: GuildMemoryNamespace;
  content: string;
  metadata?: Record<string, unknown>;
  provider?: "sqlite" | "chroma";
  embeddingRef?: string | null;
  createdAt: number;
};

const namespaces = new Set<GuildMemoryNamespace>([
  "operations",
  "governance",
  "accounting",
  "runtime",
  "customer",
  "learning",
]);

export function isGuildMemoryNamespace(value: string): value is GuildMemoryNamespace {
  return namespaces.has(value as GuildMemoryNamespace);
}

export function recordGuildMemory(db: DbLike, input: GuildMemoryInput): GuildMemoryRecord {
  const content = input.content.trim();
  if (!input.guildId.trim()) throw new Error("guildId is required.");
  if (!content) throw new Error("memory content is required.");
  if (!isGuildMemoryNamespace(input.namespace)) throw new Error("invalid memory namespace.");

  const id = randomUUID();
  const metadata = JSON.stringify(input.metadata ?? {});
  const provider = input.provider ?? "sqlite";

  db.prepare(
    `INSERT INTO guild_memory_records (
      id, guild_id, provider, namespace, content, metadata_json, embedding_ref, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.guildId, provider, input.namespace, content, metadata, input.embeddingRef ?? null, input.createdAt);

  return {
    id,
    guild_id: input.guildId,
    provider,
    namespace: input.namespace,
    content,
    metadata_json: metadata,
    embedding_ref: input.embeddingRef ?? null,
    created_at: input.createdAt,
  };
}

export function listGuildMemories(
  db: DbLike,
  input: { guildId: string; namespace?: GuildMemoryNamespace | null; limit?: number },
): GuildMemoryRecord[] {
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 20), 100));
  if (input.namespace) {
    return db
      .prepare(
        `SELECT id, guild_id, provider, namespace, content, metadata_json, embedding_ref, created_at
         FROM guild_memory_records
         WHERE guild_id = ? AND namespace = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(input.guildId, input.namespace, limit) as GuildMemoryRecord[];
  }

  return db
    .prepare(
      `SELECT id, guild_id, provider, namespace, content, metadata_json, embedding_ref, created_at
       FROM guild_memory_records
       WHERE guild_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(input.guildId, limit) as GuildMemoryRecord[];
}

export function countGuildMemories(db: DbLike, guildId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM guild_memory_records WHERE guild_id = ?")
    .get(guildId) as { count: number } | undefined;
  return row?.count ?? 0;
}
