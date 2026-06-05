import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { createGuildReviewQueueItem } from "./review-queue.ts";
import { getActivePolicyVersionId, getActivePromptVersionId } from "./versioning.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildEvalVerdict = "pass" | "warn" | "fail" | "skipped";

export type GuildEvalCase = {
  id: string;
  guild_id: string;
  name: string;
  task_description: string;
  expected_behavior: string;
  rubric_json: string;
  tags_json: string;
  enabled: number;
  created_at: number;
  updated_at: number;
};

export type GuildEvalRun = {
  id: string;
  guild_id: string;
  case_id: string | null;
  model_provider: string | null;
  model_name: string | null;
  prompt_version_id: string | null;
  policy_version_id: string | null;
  memory_snapshot_id: string | null;
  output_text: string;
  score: number;
  verdict: GuildEvalVerdict;
  evidence_json: string;
  created_at: number;
};

type EvalRubric = {
  requiredKeywords?: string[];
  forbiddenKeywords?: string[];
  minLength?: number;
  maxLength?: number;
  mustMentionSource?: boolean;
  mustNotClaimUnsupportedMemory?: boolean;
};

function safeJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

export function scoreGuildEvalOutput(input: { outputText: string; rubric: EvalRubric }): {
  score: number;
  verdict: GuildEvalVerdict;
  evidence: Record<string, unknown>;
} {
  const output = input.outputText.trim();
  if (!output) return { score: 0, verdict: "skipped", evidence: { reason: "empty_output" } };
  const lower = output.toLowerCase();
  const required = asStringArray(input.rubric.requiredKeywords);
  const forbidden = asStringArray(input.rubric.forbiddenKeywords);
  const missingRequired = required.filter((keyword) => !lower.includes(keyword.toLowerCase()));
  const foundForbidden = forbidden.filter((keyword) => lower.includes(keyword.toLowerCase()));
  const minLength = Number(input.rubric.minLength ?? 0);
  const maxLength = Number(input.rubric.maxLength ?? 0);
  const tooShort = Number.isFinite(minLength) && minLength > 0 && output.length < minLength;
  const tooLong = Number.isFinite(maxLength) && maxLength > 0 && output.length > maxLength;
  const sourceMissing =
    input.rubric.mustMentionSource === true && !/(source|evidence|according to|based on|อ้างอิง|หลักฐาน)/i.test(output);
  const unsupportedMemoryClaim =
    input.rubric.mustNotClaimUnsupportedMemory === true && /(i remember|from memory|ตามความจำ|จำได้ว่า)/i.test(output);

  const failures = [
    ...missingRequired.map((keyword) => `missing:${keyword}`),
    ...foundForbidden.map((keyword) => `forbidden:${keyword}`),
    ...(unsupportedMemoryClaim ? ["unsupported_memory_claim"] : []),
  ];
  const warnings = [...(tooShort ? ["too_short"] : []), ...(tooLong ? ["too_long"] : []), ...(sourceMissing ? ["source_missing"] : [])];
  const score = Math.max(0, 100 - failures.length * 35 - warnings.length * 15);
  const verdict: GuildEvalVerdict = failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
  return {
    score,
    verdict,
    evidence: { missingRequired, foundForbidden, tooShort, tooLong, sourceMissing, unsupportedMemoryClaim },
  };
}

export function createGuildEvalCase(
  db: DbLike,
  input: {
    guildId: string;
    name: string;
    taskDescription: string;
    expectedBehavior: string;
    rubric?: Record<string, unknown>;
    tags?: string[];
    enabled?: boolean;
    now: number;
  },
): GuildEvalCase {
  if (!input.guildId.trim()) throw new Error("guildId is required.");
  if (!input.name.trim()) throw new Error("eval name is required.");
  if (!input.taskDescription.trim()) throw new Error("taskDescription is required.");
  if (!input.expectedBehavior.trim()) throw new Error("expectedBehavior is required.");
  const id = randomUUID();
  db.prepare(
    `INSERT INTO guild_eval_cases (
      id, guild_id, name, task_description, expected_behavior, rubric_json, tags_json, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.guildId,
    input.name.trim(),
    input.taskDescription.trim(),
    input.expectedBehavior.trim(),
    JSON.stringify(input.rubric ?? {}),
    JSON.stringify(input.tags ?? []),
    input.enabled === false ? 0 : 1,
    input.now,
    input.now,
  );
  return db.prepare("SELECT * FROM guild_eval_cases WHERE id = ?").get(id) as GuildEvalCase;
}

export function listGuildEvalCases(db: DbLike, input: { guildId?: string | null; enabledOnly?: boolean; limit?: number }): GuildEvalCase[] {
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 50), 100));
  if (input.guildId) {
    const enabledClause = input.enabledOnly ? "AND enabled = 1" : "";
    return db
      .prepare(`SELECT * FROM guild_eval_cases WHERE guild_id = ? ${enabledClause} ORDER BY updated_at DESC LIMIT ?`)
      .all(input.guildId, limit) as GuildEvalCase[];
  }
  return db.prepare("SELECT * FROM guild_eval_cases ORDER BY updated_at DESC LIMIT ?").all(limit) as GuildEvalCase[];
}

export function seedDefaultGuildEvalCases(db: DbLike, now: number): number {
  const seeds = [
    {
      guildId: "ecom-001",
      name: "E-commerce customer evidence reply",
      taskDescription: "Answer a customer issue using evidence without inventing memory.",
      expectedBehavior: "Mention evidence/source and avoid unsupported memory claims.",
      tags: ["ecommerce", "support"],
    },
    {
      guildId: "software-001",
      name: "Software service QA handoff",
      taskDescription: "Explain whether a software task is ready for QA.",
      expectedBehavior: "Mention acceptance evidence and next action.",
      tags: ["software", "qa"],
    },
    {
      guildId: "content-001",
      name: "Content campaign source discipline",
      taskDescription: "Draft a content recommendation with clear source/evidence language.",
      expectedBehavior: "Avoid unsupported claims and mention source/evidence.",
      tags: ["content", "marketing"],
    },
  ];
  let created = 0;
  for (const seed of seeds) {
    const existing = db
      .prepare("SELECT id FROM guild_eval_cases WHERE guild_id = ? AND name = ?")
      .get(seed.guildId, seed.name) as { id: string } | undefined;
    if (existing) continue;
    createGuildEvalCase(db, {
      ...seed,
      rubric: { requiredKeywords: ["evidence"], forbiddenKeywords: ["guaranteed"], minLength: 40, mustMentionSource: true, mustNotClaimUnsupportedMemory: true },
      now,
    });
    created += 1;
  }
  return created;
}

export function runGuildEvalCase(
  db: DbLike,
  input: {
    guildId: string;
    caseId?: string | null;
    outputText?: string | null;
    modelProvider?: string | null;
    modelName?: string | null;
    memorySnapshotId?: string | null;
    now: number;
  },
): GuildEvalRun {
  if (!input.guildId.trim()) throw new Error("guildId is required.");
  const evalCase = input.caseId
    ? (db.prepare("SELECT * FROM guild_eval_cases WHERE id = ?").get(input.caseId) as GuildEvalCase | undefined)
    : undefined;
  if (input.caseId && !evalCase) throw new Error("eval case not found.");
  const outputText = input.outputText?.trim() ?? "";
  const rubric = safeJsonObject(evalCase?.rubric_json ?? "{}") as EvalRubric;
  const result = input.modelProvider && input.modelName && outputText ? scoreGuildEvalOutput({ outputText, rubric }) : {
    score: 0,
    verdict: "skipped" as const,
    evidence: { reason: outputText ? "runtime_unavailable" : "empty_output" },
  };
  const id = randomUUID();
  const promptVersionId = getActivePromptVersionId(db, input.guildId, "worker");
  const policyVersionId = getActivePolicyVersionId(db, input.guildId, "qa_rubric");
  db.prepare(
    `INSERT INTO guild_eval_runs (
      id, guild_id, case_id, model_provider, model_name, prompt_version_id, policy_version_id,
      memory_snapshot_id, output_text, score, verdict, evidence_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.guildId,
    input.caseId ?? null,
    input.modelProvider ?? null,
    input.modelName ?? null,
    promptVersionId,
    policyVersionId,
    input.memorySnapshotId ?? null,
    outputText,
    result.score,
    result.verdict,
    JSON.stringify(result.evidence),
    input.now,
  );
  if (result.verdict === "fail") {
    createGuildReviewQueueItem(db, {
      guildId: input.guildId,
      reviewType: "eval_regression",
      title: `Eval failed${evalCase ? `: ${evalCase.name}` : ""}`,
      description: "A deterministic Guild AI evaluation failed and needs human review before using this behavior as a baseline.",
      sourceTable: "guild_eval_runs",
      sourceId: id,
      priority: "high",
      requestedBy: "eval_runner",
      evidence: result.evidence,
      now: input.now,
    });
  }
  return db.prepare("SELECT * FROM guild_eval_runs WHERE id = ?").get(id) as GuildEvalRun;
}

export function listGuildEvalRuns(db: DbLike, input: { guildId?: string | null; caseId?: string | null; limit?: number }): GuildEvalRun[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (input.guildId) {
    clauses.push("guild_id = ?");
    params.push(input.guildId);
  }
  if (input.caseId) {
    clauses.push("case_id = ?");
    params.push(input.caseId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(Math.max(1, Math.min(Math.floor(input.limit ?? 50), 100)));
  return db.prepare(`SELECT * FROM guild_eval_runs ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as GuildEvalRun[];
}
