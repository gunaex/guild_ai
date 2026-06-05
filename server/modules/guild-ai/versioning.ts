import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { createGuildReviewQueueItem } from "./review-queue.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildPromptScope = "worker" | "qa" | "pm" | "sgm" | "hr" | "community" | "accounting" | "routing";
export type GuildPolicyType =
  | "routing"
  | "qa_rubric"
  | "budget"
  | "memory"
  | "hr_scoring"
  | "accounting"
  | "security"
  | "self_improvement";
export type GuildVersionStatus = "draft" | "active" | "deprecated" | "archived";

export type GuildPromptVersion = {
  id: string;
  guild_id: string;
  scope: GuildPromptScope;
  name: string;
  version: string;
  content: string;
  checksum: string;
  status: GuildVersionStatus;
  created_by: string | null;
  created_at: number;
  activated_at: number | null;
  deprecated_at: number | null;
};

export type GuildPolicyVersion = {
  id: string;
  guild_id: string;
  policy_type: GuildPolicyType;
  name: string;
  version: string;
  content_json: string;
  checksum: string;
  status: GuildVersionStatus;
  created_by: string | null;
  created_at: number;
  activated_at: number | null;
  deprecated_at: number | null;
};

const promptScopes = new Set<GuildPromptScope>(["worker", "qa", "pm", "sgm", "hr", "community", "accounting", "routing"]);
const policyTypes = new Set<GuildPolicyType>([
  "routing",
  "qa_rubric",
  "budget",
  "memory",
  "hr_scoring",
  "accounting",
  "security",
  "self_improvement",
]);

export function checksumContent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isPromptScope(value: string): value is GuildPromptScope {
  return promptScopes.has(value as GuildPromptScope);
}

export function isPolicyType(value: string): value is GuildPolicyType {
  return policyTypes.has(value as GuildPolicyType);
}

function assertCommon(input: { guildId: string; name: string; version: string }) {
  if (!input.guildId.trim()) throw new Error("guildId is required.");
  if (!input.name.trim()) throw new Error("name is required.");
  if (!input.version.trim()) throw new Error("version is required.");
}

export function createGuildPromptVersion(
  db: DbLike,
  input: {
    guildId: string;
    scope: GuildPromptScope;
    name: string;
    version: string;
    content: string;
    createdBy?: string | null;
    now: number;
  },
): GuildPromptVersion {
  assertCommon(input);
  if (!isPromptScope(input.scope)) throw new Error("invalid prompt scope.");
  if (!input.content.trim()) throw new Error("content is required.");
  const id = randomUUID();
  const checksum = checksumContent(input.content);
  db.prepare(
    `INSERT INTO guild_prompt_versions (
      id, guild_id, scope, name, version, content, checksum, status, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
  ).run(id, input.guildId, input.scope, input.name.trim(), input.version.trim(), input.content, checksum, input.createdBy ?? null, input.now);
  createGuildReviewQueueItem(db, {
    guildId: input.guildId,
    reviewType: "prompt_change",
    title: `Review prompt ${input.scope}/${input.version}`,
    description: `Prompt version ${input.name} is ready for human review before activation.`,
    sourceTable: "guild_prompt_versions",
    sourceId: id,
    priority: "normal",
    requestedBy: input.createdBy ?? "system",
    evidence: { checksum, scope: input.scope },
    now: input.now,
  });
  return db.prepare("SELECT * FROM guild_prompt_versions WHERE id = ?").get(id) as GuildPromptVersion;
}

export function createGuildPolicyVersion(
  db: DbLike,
  input: {
    guildId: string;
    policyType: GuildPolicyType;
    name: string;
    version: string;
    content: Record<string, unknown>;
    createdBy?: string | null;
    now: number;
  },
): GuildPolicyVersion {
  assertCommon(input);
  if (!isPolicyType(input.policyType)) throw new Error("invalid policy type.");
  const contentJson = JSON.stringify(input.content ?? {});
  const id = randomUUID();
  const checksum = checksumContent(contentJson);
  db.prepare(
    `INSERT INTO guild_policy_versions (
      id, guild_id, policy_type, name, version, content_json, checksum, status, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
  ).run(id, input.guildId, input.policyType, input.name.trim(), input.version.trim(), contentJson, checksum, input.createdBy ?? null, input.now);
  createGuildReviewQueueItem(db, {
    guildId: input.guildId,
    reviewType: "policy_change",
    title: `Review policy ${input.policyType}/${input.version}`,
    description: `Policy version ${input.name} is ready for human review before activation.`,
    sourceTable: "guild_policy_versions",
    sourceId: id,
    priority: "normal",
    requestedBy: input.createdBy ?? "system",
    evidence: { checksum, policyType: input.policyType },
    now: input.now,
  });
  return db.prepare("SELECT * FROM guild_policy_versions WHERE id = ?").get(id) as GuildPolicyVersion;
}

export function listGuildPromptVersions(db: DbLike, guildId: string, scope?: GuildPromptScope | null): GuildPromptVersion[] {
  if (scope) {
    return db
      .prepare("SELECT * FROM guild_prompt_versions WHERE guild_id = ? AND scope = ? ORDER BY created_at DESC")
      .all(guildId, scope) as GuildPromptVersion[];
  }
  return db.prepare("SELECT * FROM guild_prompt_versions WHERE guild_id = ? ORDER BY created_at DESC").all(guildId) as GuildPromptVersion[];
}

export function listGuildPolicyVersions(db: DbLike, guildId: string, policyType?: GuildPolicyType | null): GuildPolicyVersion[] {
  if (policyType) {
    return db
      .prepare("SELECT * FROM guild_policy_versions WHERE guild_id = ? AND policy_type = ? ORDER BY created_at DESC")
      .all(guildId, policyType) as GuildPolicyVersion[];
  }
  return db.prepare("SELECT * FROM guild_policy_versions WHERE guild_id = ? ORDER BY created_at DESC").all(guildId) as GuildPolicyVersion[];
}

export function activateGuildPromptVersion(db: DbLike, id: string, now: number): GuildPromptVersion {
  const row = db.prepare("SELECT * FROM guild_prompt_versions WHERE id = ?").get(id) as GuildPromptVersion | undefined;
  if (!row) throw new Error("prompt version not found.");
  db.prepare("UPDATE guild_prompt_versions SET status = 'deprecated', deprecated_at = ? WHERE guild_id = ? AND scope = ? AND status = 'active'").run(
    now,
    row.guild_id,
    row.scope,
  );
  db.prepare("UPDATE guild_prompt_versions SET status = 'active', activated_at = ?, deprecated_at = NULL WHERE id = ?").run(now, id);
  return db.prepare("SELECT * FROM guild_prompt_versions WHERE id = ?").get(id) as GuildPromptVersion;
}

export function activateGuildPolicyVersion(db: DbLike, id: string, now: number): GuildPolicyVersion {
  const row = db.prepare("SELECT * FROM guild_policy_versions WHERE id = ?").get(id) as GuildPolicyVersion | undefined;
  if (!row) throw new Error("policy version not found.");
  db.prepare(
    "UPDATE guild_policy_versions SET status = 'deprecated', deprecated_at = ? WHERE guild_id = ? AND policy_type = ? AND status = 'active'",
  ).run(now, row.guild_id, row.policy_type);
  db.prepare("UPDATE guild_policy_versions SET status = 'active', activated_at = ?, deprecated_at = NULL WHERE id = ?").run(now, id);
  return db.prepare("SELECT * FROM guild_policy_versions WHERE id = ?").get(id) as GuildPolicyVersion;
}

export function deprecateGuildPromptVersion(db: DbLike, id: string, now: number): GuildPromptVersion {
  db.prepare("UPDATE guild_prompt_versions SET status = 'deprecated', deprecated_at = ? WHERE id = ?").run(now, id);
  const row = db.prepare("SELECT * FROM guild_prompt_versions WHERE id = ?").get(id) as GuildPromptVersion | undefined;
  if (!row) throw new Error("prompt version not found.");
  return row;
}

export function deprecateGuildPolicyVersion(db: DbLike, id: string, now: number): GuildPolicyVersion {
  db.prepare("UPDATE guild_policy_versions SET status = 'deprecated', deprecated_at = ? WHERE id = ?").run(now, id);
  const row = db.prepare("SELECT * FROM guild_policy_versions WHERE id = ?").get(id) as GuildPolicyVersion | undefined;
  if (!row) throw new Error("policy version not found.");
  return row;
}

export function getActivePromptVersionId(db: DbLike, guildId: string, scope: GuildPromptScope): string | null {
  const row = db
    .prepare("SELECT id FROM guild_prompt_versions WHERE guild_id = ? AND scope = ? AND status = 'active' LIMIT 1")
    .get(guildId, scope) as { id: string } | undefined;
  return row?.id ?? null;
}

export function getActivePolicyVersionId(db: DbLike, guildId: string, policyType: GuildPolicyType): string | null {
  const row = db
    .prepare("SELECT id FROM guild_policy_versions WHERE guild_id = ? AND policy_type = ? AND status = 'active' LIMIT 1")
    .get(guildId, policyType) as { id: string } | undefined;
  return row?.id ?? null;
}
