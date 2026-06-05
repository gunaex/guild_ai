import type { DatabaseSync } from "node:sqlite";
import { recordGuildMemory, type GuildMemoryNamespace, type GuildMemoryQualityStatus, type GuildMemoryRiskLevel } from "./memory.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export interface MemorySearchQuery {
  guildId: string;
  namespace?: string;
  query: string;
  topK?: number;
  minQualityStatus?: "draft" | "reviewed" | "approved";
  includeDeprecated?: boolean;
}

export interface MemorySearchResult {
  id: string;
  guildId: string;
  namespace: string;
  text: string;
  score?: number;
  sourceType?: string;
  qualityStatus?: string;
  riskLevel?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryIndexInput {
  guildId: string;
  namespace: string;
  text: string;
  sourceType?: string;
  qualityStatus?: string;
  riskLevel?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryProvider {
  name: string;
  health(): Promise<{ ok: boolean; details?: Record<string, unknown> }>;
  search(query: MemorySearchQuery): Promise<MemorySearchResult[]>;
  index(input: MemoryIndexInput): Promise<{ ok: boolean; id?: string; error?: string }>;
}

const qualityRank: Record<string, number> = { draft: 0, reviewed: 1, approved: 2, deprecated: -1, archived: -2 };

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class SQLiteMemoryProvider implements MemoryProvider {
  name = "sqlite";

  constructor(
    private readonly db: DbLike,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async health(): Promise<{ ok: boolean; details?: Record<string, unknown> }> {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM guild_memory_records").get() as { count: number } | undefined;
    return { ok: true, details: { records: row?.count ?? 0, provider: this.name } };
  }

  async search(query: MemorySearchQuery): Promise<MemorySearchResult[]> {
    const terms = query.query
      .toLowerCase()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean);
    const clauses = ["guild_id = ?"];
    const params: Array<string | number> = [query.guildId];
    if (query.namespace) {
      clauses.push("namespace = ?");
      params.push(query.namespace);
    }
    if (!query.includeDeprecated) {
      clauses.push("quality_status NOT IN ('deprecated','archived')");
    }
    const rows = this.db
      .prepare(
        `SELECT *
         FROM guild_memory_records
         WHERE ${clauses.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT 200`,
      )
      .all(...params) as Array<{
      id: string;
      guild_id: string;
      namespace: string;
      content: string;
      metadata_json: string;
      source_type: string | null;
      quality_status: string;
      risk_level: string;
    }>;
    const minRank = query.minQualityStatus ? qualityRank[query.minQualityStatus] : qualityRank.reviewed;
    return rows
      .filter((row) => qualityRank[row.quality_status] >= minRank)
      .map((row) => {
        const lower = row.content.toLowerCase();
        const score = terms.length === 0 ? 0.1 : terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0) / terms.length;
        return {
          id: row.id,
          guildId: row.guild_id,
          namespace: row.namespace,
          text: row.content,
          score,
          sourceType: row.source_type ?? undefined,
          qualityStatus: row.quality_status,
          riskLevel: row.risk_level,
          metadata: parseMetadata(row.metadata_json),
        };
      })
      .filter((row) => terms.length === 0 || (row.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, Math.max(1, Math.min(Math.floor(query.topK ?? 5), 20)));
  }

  async index(input: MemoryIndexInput): Promise<{ ok: boolean; id?: string; error?: string }> {
    try {
      const record = recordGuildMemory(this.db, {
        guildId: input.guildId,
        namespace: input.namespace as GuildMemoryNamespace,
        content: input.text,
        metadata: input.metadata,
        sourceType: input.sourceType ?? "memory_provider",
        qualityStatus: (input.qualityStatus ?? "draft") as GuildMemoryQualityStatus,
        riskLevel: (input.riskLevel ?? "normal") as GuildMemoryRiskLevel,
        createdAt: this.now(),
      });
      return { ok: true, id: record.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export function listMemoryProviders(db: DbLike): MemoryProvider[] {
  return [new SQLiteMemoryProvider(db)];
}
