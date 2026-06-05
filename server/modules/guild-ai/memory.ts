import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildMemoryNamespace = "operations" | "governance" | "accounting" | "runtime" | "customer" | "learning";
export type GuildMemoryQualityStatus = "draft" | "reviewed" | "approved" | "deprecated" | "archived";
export type GuildMemoryRiskLevel = "low" | "normal" | "high" | "critical";

export type GuildMemoryRecord = {
  id: string;
  guild_id: string;
  provider: "sqlite" | "chroma";
  namespace: GuildMemoryNamespace;
  content: string;
  metadata_json: string;
  embedding_ref: string | null;
  quality_status: GuildMemoryQualityStatus;
  confidence_score: number | null;
  source_type: string | null;
  approved_by: string | null;
  approved_at: number | null;
  valid_until: number | null;
  risk_level: GuildMemoryRiskLevel;
  supersedes_memory_id: string | null;
  deprecated_at: number | null;
  archived_at: number | null;
  created_at: number;
};

export type GuildMemoryInput = {
  guildId: string;
  namespace: GuildMemoryNamespace;
  content: string;
  metadata?: Record<string, unknown>;
  provider?: "sqlite" | "chroma";
  embeddingRef?: string | null;
  qualityStatus?: GuildMemoryQualityStatus;
  confidenceScore?: number | null;
  sourceType?: string | null;
  riskLevel?: GuildMemoryRiskLevel;
  supersedesMemoryId?: string | null;
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
const qualityStatuses = new Set<GuildMemoryQualityStatus>(["draft", "reviewed", "approved", "deprecated", "archived"]);
const riskLevels = new Set<GuildMemoryRiskLevel>(["low", "normal", "high", "critical"]);

export function isGuildMemoryNamespace(value: string): value is GuildMemoryNamespace {
  return namespaces.has(value as GuildMemoryNamespace);
}

export function isGuildMemoryQualityStatus(value: string): value is GuildMemoryQualityStatus {
  return qualityStatuses.has(value as GuildMemoryQualityStatus);
}

export function isGuildMemoryRiskLevel(value: string): value is GuildMemoryRiskLevel {
  return riskLevels.has(value as GuildMemoryRiskLevel);
}

export function recordGuildMemory(db: DbLike, input: GuildMemoryInput): GuildMemoryRecord {
  const content = input.content.trim();
  if (!input.guildId.trim()) throw new Error("guildId is required.");
  if (!content) throw new Error("memory content is required.");
  if (!isGuildMemoryNamespace(input.namespace)) throw new Error("invalid memory namespace.");

  const id = randomUUID();
  const metadata = JSON.stringify(input.metadata ?? {});
  const provider = input.provider ?? "sqlite";
  const qualityStatus = input.qualityStatus ?? "draft";
  const riskLevel = input.riskLevel ?? "normal";
  if (!isGuildMemoryQualityStatus(qualityStatus)) throw new Error("invalid memory quality status.");
  if (!isGuildMemoryRiskLevel(riskLevel)) throw new Error("invalid memory risk level.");

  db.prepare(
    `INSERT INTO guild_memory_records (
      id, guild_id, provider, namespace, content, metadata_json, embedding_ref,
      quality_status, confidence_score, source_type, risk_level, supersedes_memory_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.guildId,
    provider,
    input.namespace,
    content,
    metadata,
    input.embeddingRef ?? null,
    qualityStatus,
    input.confidenceScore ?? null,
    input.sourceType ?? null,
    riskLevel,
    input.supersedesMemoryId ?? null,
    input.createdAt,
  );

  return {
    id,
    guild_id: input.guildId,
    provider,
    namespace: input.namespace,
    content,
    metadata_json: metadata,
    embedding_ref: input.embeddingRef ?? null,
    quality_status: qualityStatus,
    confidence_score: input.confidenceScore ?? null,
    source_type: input.sourceType ?? null,
    approved_by: null,
    approved_at: null,
    valid_until: null,
    risk_level: riskLevel,
    supersedes_memory_id: input.supersedesMemoryId ?? null,
    deprecated_at: null,
    archived_at: null,
    created_at: input.createdAt,
  };
}

export function listGuildMemories(
  db: DbLike,
  input: {
    guildId: string;
    namespace?: GuildMemoryNamespace | null;
    qualityStatus?: GuildMemoryQualityStatus | null;
    riskLevel?: GuildMemoryRiskLevel | null;
    includeArchived?: boolean;
    limit?: number;
  },
): GuildMemoryRecord[] {
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 20), 100));
  const clauses = ["guild_id = ?"];
  const params: Array<string | number> = [input.guildId];
  if (input.namespace) {
    clauses.push("namespace = ?");
    params.push(input.namespace);
  }
  if (input.qualityStatus) {
    clauses.push("quality_status = ?");
    params.push(input.qualityStatus);
  }
  if (input.riskLevel) {
    clauses.push("risk_level = ?");
    params.push(input.riskLevel);
  }
  if (!input.includeArchived) {
    clauses.push("quality_status != 'archived'");
  }
  params.push(limit);

  return db
    .prepare(
      `SELECT *
       FROM guild_memory_records
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(...params) as GuildMemoryRecord[];
}

export function countGuildMemories(db: DbLike, guildId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM guild_memory_records WHERE guild_id = ?")
    .get(guildId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function updateGuildMemoryQuality(
  db: DbLike,
  input: {
    id: string;
    qualityStatus: GuildMemoryQualityStatus;
    riskLevel?: GuildMemoryRiskLevel | null;
    confidenceScore?: number | null;
    approvedBy?: string | null;
    validUntil?: number | null;
    supersedesMemoryId?: string | null;
    now: number;
  },
): GuildMemoryRecord {
  if (!isGuildMemoryQualityStatus(input.qualityStatus)) throw new Error("invalid memory quality status.");
  if (input.riskLevel && !isGuildMemoryRiskLevel(input.riskLevel)) throw new Error("invalid memory risk level.");
  const existing = db.prepare("SELECT * FROM guild_memory_records WHERE id = ?").get(input.id) as GuildMemoryRecord | undefined;
  if (!existing) throw new Error("memory record not found.");

  const approvedAt = input.qualityStatus === "approved" ? input.now : existing.approved_at;
  const deprecatedAt = input.qualityStatus === "deprecated" ? input.now : existing.deprecated_at;
  const archivedAt = input.qualityStatus === "archived" ? input.now : existing.archived_at;
  db.prepare(
    `UPDATE guild_memory_records
     SET quality_status = ?,
         risk_level = COALESCE(?, risk_level),
         confidence_score = COALESCE(?, confidence_score),
         approved_by = COALESCE(?, approved_by),
         approved_at = ?,
         valid_until = COALESCE(?, valid_until),
         supersedes_memory_id = COALESCE(?, supersedes_memory_id),
         deprecated_at = ?,
         archived_at = ?
     WHERE id = ?`,
  ).run(
    input.qualityStatus,
    input.riskLevel ?? null,
    input.confidenceScore ?? null,
    input.approvedBy ?? null,
    approvedAt,
    input.validUntil ?? null,
    input.supersedesMemoryId ?? null,
    deprecatedAt,
    archivedAt,
    input.id,
  );
  return db.prepare("SELECT * FROM guild_memory_records WHERE id = ?").get(input.id) as GuildMemoryRecord;
}
