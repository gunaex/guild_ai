import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedStarterChartOfAccounts } from "../modules/guild-ai/accounting.ts";
import { getProfitAndLossSummary, recordTokenUsageWithJournal } from "../modules/guild-ai/accounting-journal.ts";
import { buildGuildAuditReplay } from "../modules/guild-ai/audit-replay.ts";
import { buildGuildBackupReadiness } from "../modules/guild-ai/backup-readiness.ts";
import { listGuildBackupSnapshots, resolveGuildBackupDir } from "../modules/guild-ai/backup-scheduler.ts";
import { buildGuildBudgetGuardStatus } from "../modules/guild-ai/budget-guard.ts";
import { startGuildCommunityLoungeSession } from "../modules/guild-ai/community-lounge.ts";
import { buildGuildDeploymentReadiness } from "../modules/guild-ai/deployment-readiness.ts";
import { createGuildEvalCase, runGuildEvalCase } from "../modules/guild-ai/evaluations.ts";
import { listGuildGovernanceRequests, listGuildHrReviews } from "../modules/guild-ai/hr-governance.ts";
import { SQLiteMemoryProvider } from "../modules/guild-ai/memory-provider.ts";
import { listGuildMemories, recordGuildMemory, updateGuildMemoryQuality } from "../modules/guild-ai/memory.ts";
import { scoreGuildProductivityForAllAgents } from "../modules/guild-ai/productivity-scoring.ts";
import { createGuildReviewQueueItem, decideGuildReviewQueueItem, listGuildReviewQueue } from "../modules/guild-ai/review-queue.ts";
import { listGuildRuntimeBindings } from "../modules/guild-ai/runtime-bindings.ts";
import { applyGuildTaskRouteDecision } from "../modules/guild-ai/task-routing.ts";
import {
  activateGuildPolicyVersion,
  activateGuildPromptVersion,
  createGuildPolicyVersion,
  createGuildPromptVersion,
} from "../modules/guild-ai/versioning.ts";
import { buildGuildWorkerQueueStatus, enqueueGuildWorkerJob, processNextGuildWorkerQueueItem } from "../modules/guild-ai/worker-queue.ts";
import { applyBaseSchema } from "../modules/bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../modules/bootstrap/schema/guild-ai-schema.ts";
import { seedGuildAiTemplates } from "../modules/bootstrap/schema/guild-ai-seeds.ts";

type StageStatus = "pass" | "warn" | "fail" | "skipped";

type BctStage = {
  name: string;
  status: StageStatus;
  checks: string[];
  evidence: Record<string, unknown>;
  message: string;
};

type BctContext = {
  repoRoot: string;
  db: DatabaseSync;
  dbPath: string;
  logsDir: string;
  guildId: string;
  now: number;
  stamp: string;
  bctTag: string;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const guildId = process.env.GUILD_AI_GUILD_ID?.trim() || "ecom-001";
const dbPath = path.resolve(repoRoot, process.env.DB_PATH?.trim() || "claw-empire.sqlite");
const logsDir = path.resolve(repoRoot, process.env.LOGS_DIR?.trim() || "logs");
const artifactDir = path.join(repoRoot, "artifacts", "guild-bct");
const now = Date.now();
const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
const bctTag = `[BCT] ${stamp}`;

function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as
    | { name: string }
    | undefined;
  return Boolean(row);
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

function count(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): number {
  const row = db.prepare(sql).get(...params) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

function one<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T | null {
  return (db.prepare(sql).get(...params) as T | undefined) ?? null;
}

function getCommit(repo: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function decideStatus(statuses: StageStatus[]): StageStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn")) return "warn";
  if (statuses.every((status) => status === "skipped")) return "skipped";
  return "pass";
}

function makeStage(
  name: string,
  statuses: StageStatus[],
  checks: string[],
  evidence: Record<string, unknown>,
  message: string,
): BctStage {
  return { name, status: decideStatus(statuses), checks, evidence, message };
}

function createBctTask(
  db: DatabaseSync,
  input: {
    id: string;
    title: string;
    status?: string;
    assignedAgentId?: string | null;
    projectPath?: string | null;
    workflowMeta?: Record<string, unknown>;
    now: number;
  },
): string {
  db.prepare(
    `INSERT OR REPLACE INTO tasks (
      id, title, description, assigned_agent_id, status, priority, task_type,
      workflow_pack_key, workflow_meta_json, project_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, 'general', 'development', ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.title,
    `${input.title} - created by Guild AI Business Continuity Test.`,
    input.assignedAgentId ?? null,
    input.status ?? "planned",
    JSON.stringify(input.workflowMeta ?? {}),
    input.projectPath ?? null,
    input.now,
    input.now,
  );
  db.prepare("INSERT INTO task_logs (task_id, kind, message, created_at) VALUES (?, 'system', ?, ?)").run(
    input.id,
    `${bctTag} task created for continuity evidence.`,
    input.now,
  );
  return input.id;
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readDotenvValue(repo: string, key: string): string | undefined {
  const envPath = path.join(repo, ".env");
  if (!fs.existsSync(envPath)) return undefined;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const prefix = `${key}=`;
  const line = lines.find((item) => item.startsWith(prefix));
  if (!line) return undefined;
  return line.slice(prefix.length).trim().replace(/^["']|["']$/g, "") || undefined;
}

function resolveLocalAuthToken(repo: string): string | undefined {
  return (
    process.env.API_AUTH_TOKEN?.trim() ||
    process.env.SESSION_AUTH_TOKEN?.trim() ||
    readDotenvValue(repo, "API_AUTH_TOKEN") ||
    readDotenvValue(repo, "SESSION_AUTH_TOKEN")
  );
}

async function fetchJson(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; status?: number; json?: unknown; error?: string; setCookie?: string[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    const json = (await response.json().catch(() => null)) as unknown;
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const setCookie = getSetCookie ? getSetCookie.call(response.headers) : response.headers.get("set-cookie") ? [response.headers.get("set-cookie") as string] : [];
    return { ok: response.ok, status: response.status, json, setCookie };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGuildHealth(
  serverUrl: string,
  authToken: string | undefined,
): Promise<{ ok: boolean; status?: number; json?: unknown; error?: string; authMode: "bearer" | "session" | "none" }> {
  if (authToken) {
    const result = await fetchJson(`${serverUrl}/api/guild-ai/health`, 1200, { authorization: `Bearer ${authToken}` });
    return { ...result, authMode: "bearer" };
  }

  const session = await fetchJson(`${serverUrl}/api/auth/session`, 1200);
  const cookie = session.setCookie?.map((item) => item.split(";")[0]).join("; ");
  if (cookie) {
    const result = await fetchJson(`${serverUrl}/api/guild-ai/health`, 1200, { cookie });
    return { ...result, authMode: "session" };
  }

  const result = await fetchJson(`${serverUrl}/api/guild-ai/health`, 1200);
  return { ...result, authMode: "none" };
}

function requireTables(db: DatabaseSync, tables: string[]): { ok: boolean; missing: string[] } {
  const missing = tables.filter((table) => !tableExists(db, table));
  return { ok: missing.length === 0, missing };
}

async function runStage(name: string, fn: () => Promise<BctStage> | BctStage): Promise<BctStage> {
  try {
    return await fn();
  } catch (err) {
    return {
      name,
      status: "fail",
      checks: ["stage completed without unhandled exception"],
      evidence: { error: err instanceof Error ? err.stack ?? err.message : String(err) },
      message: "Hard failure while running BCT stage.",
    };
  }
}

async function stageEnvironment(ctx: BctContext): Promise<BctStage> {
  const coreTables = requireTables(ctx.db, ["tasks", "projects", "agents", "task_logs"]);
  const guildTables = requireTables(ctx.db, [
    "guild_templates",
    "guild_agent_roles",
    "guild_runtime_bindings",
    "guild_worker_queue",
    "guild_memory_records",
    "guild_review_queue",
    "guild_eval_cases",
    "guild_prompt_versions",
    "guild_policy_versions",
  ]);
  const routeSource = fs.readFileSync(path.join(ctx.repoRoot, "server", "modules", "routes", "guild-ai.ts"), "utf8");
  const routeHealthRegistered = routeSource.includes("/health");
  const serverUrls = (
    process.env.GUILD_BCT_SERVER_URLS?.split(",") ??
    (process.env.GUILD_BCT_SERVER_URL ? [process.env.GUILD_BCT_SERVER_URL] : ["http://127.0.0.1:8802", "http://127.0.0.1:8790"])
  )
    .map((url) => url.trim())
    .filter(Boolean);
  const authToken = resolveLocalAuthToken(ctx.repoRoot);
  const healthChecks = [];
  for (const serverUrl of serverUrls) {
    healthChecks.push({ serverUrl, ...(await fetchGuildHealth(serverUrl, authToken)) });
  }
  const health = healthChecks.find((check) => check.ok) ?? healthChecks[0] ?? { ok: false, error: "no server URL configured" };
  const statuses: StageStatus[] = [
    coreTables.ok ? "pass" : "fail",
    guildTables.ok ? "pass" : "fail",
    routeHealthRegistered ? "pass" : "fail",
    health.ok ? "pass" : "warn",
  ];
  return makeStage(
    "Environment Health",
    statuses,
    [
      "database opened",
      "original Claw-Empire tables exist",
      "Guild AI tables exist",
      "Guild AI health route is registered",
      "server health endpoint is reachable when local server is running",
    ],
    {
      dbPath: ctx.dbPath,
      serverUrls,
      coreMissingTables: coreTables.missing,
      guildMissingTables: guildTables.missing,
      routeHealthRegistered,
      authTokenSource: authToken ? "env_or_dotenv" : "missing",
      healthChecks,
      sqliteIntegrity: one<{ integrity_check: string }>(ctx.db, "PRAGMA integrity_check")?.integrity_check ?? "unknown",
    },
    health.ok ? "DB, routes, and server health are reachable." : "DB and routes are ready; local server health was not reachable.",
  );
}

function stageClawCompatibility(ctx: BctContext): BctStage {
  const taskId = `BCT_CLAW_${ctx.stamp}`;
  createBctTask(ctx.db, {
    id: taskId,
    title: `${ctx.bctTag} Claw compatibility task lifecycle`,
    status: "inbox",
    workflowMeta: { bct: true, source: "claw_compatibility" },
    now: ctx.now,
  });
  ctx.db.prepare("UPDATE tasks SET status = 'planned', updated_at = ? WHERE id = ?").run(ctx.now + 1, taskId);
  ctx.db.prepare("UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?").run(ctx.now + 2, ctx.now + 2, taskId);
  ctx.db.prepare("INSERT INTO task_logs (task_id, kind, message, created_at) VALUES (?, 'system', ?, ?)").run(
    taskId,
    `${ctx.bctTag} original task lifecycle reached done.`,
    ctx.now + 2,
  );
  const task = one<{ status: string }>(ctx.db, "SELECT status FROM tasks WHERE id = ?", taskId);
  const agentCount = count(ctx.db, "SELECT COUNT(*) AS count FROM agents");
  const projectCount = count(ctx.db, "SELECT COUNT(*) AS count FROM projects");
  return makeStage(
    "Claw-Empire Compatibility",
    [task?.status === "done" ? "pass" : "fail", agentCount > 0 ? "pass" : "warn"],
    ["created task through original tasks table", "moved task lifecycle to done", "listed original agents/projects"],
    { taskId, taskStatus: task?.status ?? null, agentCount, projectCount },
    "Original task lifecycle and runtime tables coexist with Guild AI schema.",
  );
}

function stageTemplateRuntime(ctx: BctContext): BctStage {
  const templates = ctx.db
    .prepare("SELECT guild_id AS guildId, name FROM guild_templates ORDER BY guild_id ASC")
    .all() as Array<{ guildId: string; name: string }>;
  const required = ["ecom-001", "software-001", "content-001"];
  const missing = required.filter((id) => !templates.some((template) => template.guildId === id));
  const bindings = listGuildRuntimeBindings(ctx.db, ctx.guildId);
  const available = bindings.filter((binding) => binding.availability_status === "available").length;
  const limited = bindings.filter((binding) => binding.availability_status === "limited").length;
  return makeStage(
    "Guild Templates and Runtime Binding",
    [missing.length === 0 ? "pass" : "fail", bindings.length > 0 ? "pass" : "warn"],
    ["required templates seeded", "runtime bindings can be listed", "limited bindings summarized without blocking unrelated roles"],
    {
      templates,
      missingTemplates: missing,
      bindingCount: bindings.length,
      availableBindings: available,
      limitedBindings: limited,
      roles: bindings.map((binding) => ({
        role: binding.guild_role_key,
        provider: binding.api_provider_name,
        model: binding.model,
        availability: binding.availability_status,
      })),
    },
    bindings.length > 0 ? "Templates and runtime bindings are visible." : "Templates are ready; no runtime bindings were found.",
  );
}

async function stageOllama(ctx: BctContext): Promise<BctStage> {
  const modelsResponse = await fetchJson("http://127.0.0.1:11434/v1/models", 1500);
  if (!modelsResponse.ok) {
    return makeStage(
      "Local Runtime Smoke",
      ["skipped"],
      ["Ollama checked without requiring cloud API"],
      { ollama: modelsResponse },
      "Ollama is offline or not reachable; runtime smoke is safely skipped.",
    );
  }
  const data = modelsResponse.json as { data?: Array<{ id?: string; name?: string }> };
  const models = Array.isArray(data.data) ? data.data.map((model) => model.id ?? model.name ?? "").filter(Boolean) : [];
  const runnable = models.filter((model) => !/embed/i.test(model));
  return makeStage(
    "Local Runtime Smoke",
    [runnable.length > 0 ? "pass" : "warn"],
    ["listed Ollama models", "embedding-only models excluded from runnable selection"],
    { modelCount: models.length, runnableModels: runnable.slice(0, 8) },
    runnable.length > 0 ? "Local Ollama has at least one runnable model." : "Ollama is reachable, but no non-embedding model was found.",
  );
}

function stageWorkerQueue(ctx: BctContext): BctStage {
  const item = enqueueGuildWorkerJob(ctx.db, {
    guildId: ctx.guildId,
    title: `${ctx.bctTag} Draft customer return reply`,
    payload: {
      bct: true,
      prompt:
        "Draft a polite concise e-commerce return reply. Mention that return eligibility depends on policy.",
    },
    priority: 2,
    maxAttempts: 1,
    now: ctx.now,
  });
  const before = buildGuildWorkerQueueStatus(ctx.db, ctx.guildId, ctx.now);
  const processed = processNextGuildWorkerQueueItem(ctx.db, { guildId: ctx.guildId, now: ctx.now + 1 });
  const after = buildGuildWorkerQueueStatus(ctx.db, ctx.guildId, ctx.now + 1);
  return makeStage(
    "Worker Queue BCT",
    [processed.reason === "budget_blocked" ? "warn" : processed.ok ? "pass" : "fail"],
    ["enqueued BCT worker job", "listed worker queue", "processed next queue item or respected Budget Guard"],
    { itemId: item.id, before: before.counts, processed, after: after.counts },
    processed.reason === "budget_blocked" ? "Budget Guard correctly blocked queue processing." : "Worker queue lifecycle completed.",
  );
}

function stageRouting(ctx: BctContext): BctStage {
  const bindings = listGuildRuntimeBindings(ctx.db, ctx.guildId);
  const roles = new Set(bindings.filter((binding) => binding.availability_status === "available").map((binding) => binding.guild_role_key));
  const required = ["worker", "qa", "techLead", "pm"];
  const missing = required.filter((role) => !roles.has(role));
  if (missing.length > 0) {
    return makeStage(
      "Guild-Aware Routing",
      ["fail"],
      ["available runtime bindings exist for deterministic routing roles"],
      { missingRoles: missing, bindingCount: bindings.length },
      "Routing cannot be verified because required active runtime bindings are missing.",
    );
  }

  const workerBinding = bindings.find((binding) => binding.guild_role_key === "worker" && binding.availability_status === "available");
  const passTaskId = `BCT_ROUTE_PASS_${ctx.stamp}`;
  createBctTask(ctx.db, {
    id: passTaskId,
    title: `${ctx.bctTag} routing QA pass path`,
    status: "in_progress",
    assignedAgentId: workerBinding?.runtime_agent_id ?? null,
    workflowMeta: { guildId: ctx.guildId, bct: true, currentGuildRole: "worker" },
    now: ctx.now,
  });
  const passWorkerDone = applyGuildTaskRouteDecision(ctx.db, {
    guildId: ctx.guildId,
    taskId: passTaskId,
    decision: "worker_done",
    now: ctx.now + 1,
  });
  const passQa = applyGuildTaskRouteDecision(ctx.db, {
    guildId: ctx.guildId,
    taskId: passTaskId,
    decision: "qa_pass",
    feedback: "BCT deterministic pass.",
    now: ctx.now + 2,
  });

  const failTaskId = `BCT_ROUTE_FAIL_${ctx.stamp}`;
  createBctTask(ctx.db, {
    id: failTaskId,
    title: `${ctx.bctTag} routing escalation path`,
    status: "in_progress",
    assignedAgentId: workerBinding?.runtime_agent_id ?? null,
    workflowMeta: { guildId: ctx.guildId, bct: true, currentGuildRole: "worker" },
    now: ctx.now,
  });
  const failWorkerDone = applyGuildTaskRouteDecision(ctx.db, {
    guildId: ctx.guildId,
    taskId: failTaskId,
    decision: "worker_done",
    now: ctx.now + 3,
  });
  const retry = applyGuildTaskRouteDecision(ctx.db, {
    guildId: ctx.guildId,
    taskId: failTaskId,
    decision: "qa_fail",
    feedback: "BCT first retry.",
    maxRetries: 1,
    now: ctx.now + 4,
  });
  const techLead = applyGuildTaskRouteDecision(ctx.db, {
    guildId: ctx.guildId,
    taskId: failTaskId,
    decision: "qa_fail",
    feedback: "BCT retry exhausted.",
    maxRetries: 1,
    now: ctx.now + 5,
  });
  const pm = applyGuildTaskRouteDecision(ctx.db, {
    guildId: ctx.guildId,
    taskId: failTaskId,
    decision: "techlead_escalate",
    feedback: "BCT PM awareness.",
    now: ctx.now + 6,
  });

  const valid =
    passWorkerDone.status === "review" &&
    passWorkerDone.assignedRole === "qa" &&
    passQa.status === "done" &&
    retry.assignedRole === "worker" &&
    techLead.assignedRole === "techLead" &&
    techLead.escalationLevel === "techLead" &&
    pm.assignedRole === "pm" &&
    pm.escalationLevel === "pm";

  return makeStage(
    "Guild-Aware Routing",
    [valid ? "pass" : "fail"],
    ["Worker done routes to QA", "QA pass routes to done", "QA fail retries worker", "retry exhaustion escalates to Tech Lead", "Tech Lead escalation routes to PM"],
    { passTaskId, failTaskId, transitions: { passWorkerDone, passQa, failWorkerDone, retry, techLead, pm } },
    valid ? "Deterministic routing path matches expected lifecycle." : "Routing transitions did not match expected lifecycle.",
  );
}

function stageAccountingBudget(ctx: BctContext): BctStage {
  seedStarterChartOfAccounts(ctx.db, ctx.guildId);
  const accountCount = count(ctx.db, "SELECT COUNT(*) AS count FROM guild_accounting_accounts WHERE guild_id = ?", ctx.guildId);
  const usage = recordTokenUsageWithJournal(ctx.db, {
    guildId: ctx.guildId,
    agentId: "BCT_agent",
    provider: "bct",
    model: "static",
    promptTokens: 100,
    completionTokens: 40,
    costUsd: 0.01,
    paidFrom: "accounts_payable",
    createdAt: ctx.now,
  });
  const pnl = getProfitAndLossSummary(ctx.db, ctx.guildId);
  const budget = buildGuildBudgetGuardStatus(ctx.db, ctx.guildId, ctx.now);
  return makeStage(
    "Accounting and Budget Guard",
    [accountCount >= 5 ? "pass" : "fail", usage.journalEntryId ? "pass" : "fail", budget.verdict === "blocked" ? "warn" : "pass"],
    ["Thai chart of accounts seeded", "token usage journal created with BCT marker", "P&L summarized", "Budget Guard status read"],
    { accountCount, tokenUsage: usage, pnl, budgetVerdict: budget.verdict, dailySpendUsd: budget.dailySpendUsd },
    budget.verdict === "blocked" ? "Accounting works; Budget Guard is currently in hard-stop state." : "Accounting and Budget Guard are operational.",
  );
}

async function stageMemory(ctx: BctContext): Promise<BctStage> {
  const requiredColumns = ["quality_status", "confidence_score", "source_type", "risk_level"];
  const columns = tableColumns(ctx.db, "guild_memory_records");
  const missingColumns = requiredColumns.filter((column) => !columns.includes(column));
  const memory = recordGuildMemory(ctx.db, {
    guildId: ctx.guildId,
    namespace: "operations",
    content: "BCT memory record: e-commerce return workflow tested successfully.",
    metadata: { bct: true, stamp: ctx.stamp },
    qualityStatus: "draft",
    confidenceScore: 0.7,
    sourceType: "bct",
    riskLevel: "low",
    createdAt: ctx.now,
  });
  const reviewed = updateGuildMemoryQuality(ctx.db, {
    id: memory.id,
    qualityStatus: "reviewed",
    confidenceScore: 0.88,
    now: ctx.now + 1,
  });
  const provider = new SQLiteMemoryProvider(ctx.db, () => ctx.now + 2);
  const health = await provider.health();
  const search = await provider.search({
    guildId: ctx.guildId,
    namespace: "operations",
    query: "BCT memory e-commerce return workflow",
    minQualityStatus: "draft",
    topK: 5,
  });
  return makeStage(
    "Memory and MemoryProvider",
    [missingColumns.length === 0 ? "pass" : "fail", health.ok ? "pass" : "fail", search.some((row) => row.id === memory.id) ? "pass" : "fail"],
    ["memory quality columns exist", "created draft BCT memory", "updated BCT memory to reviewed", "SQLite MemoryProvider health and search work"],
    { missingColumns, memoryId: memory.id, qualityStatus: reviewed.quality_status, providerHealth: health, searchHits: search.length },
    "SQLite L2 memory provider recorded and found BCT memory evidence.",
  );
}

function stageEvaluation(ctx: BctContext): BctStage {
  const evalCase = createGuildEvalCase(ctx.db, {
    guildId: ctx.guildId,
    name: `${ctx.bctTag} Return Reply Eval`,
    taskDescription: "Write a customer return reply.",
    expectedBehavior: "Must be polite, must mention return policy, must not promise unconditional refund.",
    rubric: {
      requiredKeywords: ["return", "policy"],
      forbiddenKeywords: ["guaranteed refund", "always refund"],
      minLength: 50,
      maxLength: 800,
    },
    tags: ["bct", "ecommerce", "qa"],
    now: ctx.now,
  });
  const run = runGuildEvalCase(ctx.db, {
    guildId: ctx.guildId,
    caseId: evalCase.id,
    modelProvider: "static",
    modelName: "bct",
    outputText:
      "Hello, thank you for contacting us about your return request. We will help review it politely and clearly. Return eligibility depends on the store return policy and the order condition.",
    now: ctx.now + 1,
  });
  return makeStage(
    "Evaluation Layer",
    [run.verdict === "pass" ? "pass" : "fail"],
    ["created deterministic BCT eval case", "ran eval with static local output", "captured score and verdict"],
    { evalCaseId: evalCase.id, evalRunId: run.id, score: run.score, verdict: run.verdict },
    run.verdict === "pass" ? "Deterministic eval layer passed." : "Deterministic eval layer returned non-pass verdict.",
  );
}

function stageVersioning(ctx: BctContext): BctStage {
  const prompt = createGuildPromptVersion(ctx.db, {
    guildId: ctx.guildId,
    scope: "qa",
    name: `${ctx.bctTag} QA Prompt`,
    version: `bct-${ctx.stamp}`,
    content: "Review e-commerce return replies for politeness, policy accuracy, and no unconditional refund promise.",
    createdBy: "guild-bct",
    now: ctx.now,
  });
  const activePrompt = activateGuildPromptVersion(ctx.db, prompt.id, ctx.now + 1);
  const policy = createGuildPolicyVersion(ctx.db, {
    guildId: ctx.guildId,
    policyType: "qa_rubric",
    name: `${ctx.bctTag} QA Policy`,
    version: `bct-${ctx.stamp}`,
    content: { mustMentionPolicy: true, forbiddenPromises: ["guaranteed refund", "always refund"], bct: true },
    createdBy: "guild-bct",
    now: ctx.now,
  });
  const activePolicy = activateGuildPolicyVersion(ctx.db, policy.id, ctx.now + 1);
  const activePromptCount = count(
    ctx.db,
    "SELECT COUNT(*) AS count FROM guild_prompt_versions WHERE guild_id = ? AND scope = 'qa' AND status = 'active'",
    ctx.guildId,
  );
  const activePolicyCount = count(
    ctx.db,
    "SELECT COUNT(*) AS count FROM guild_policy_versions WHERE guild_id = ? AND policy_type = 'qa_rubric' AND status = 'active'",
    ctx.guildId,
  );
  return makeStage(
    "Prompt and Policy Versioning",
    [activePrompt.status === "active" ? "pass" : "fail", activePolicy.status === "active" ? "pass" : "fail", activePromptCount === 1 ? "pass" : "fail", activePolicyCount === 1 ? "pass" : "fail"],
    ["created draft prompt version", "activated prompt version", "created draft policy version", "activated policy version", "verified only one active version per scope/type"],
    { promptId: prompt.id, policyId: policy.id, activePromptCount, activePolicyCount },
    "Prompt and policy version lifecycle is controlled and singular-active.",
  );
}

function stageReviewQueue(ctx: BctContext): BctStage {
  const item = createGuildReviewQueueItem(ctx.db, {
    guildId: ctx.guildId,
    reviewType: "manual",
    title: `${ctx.bctTag} Manual Review`,
    description: "Review BCT evidence before release.",
    priority: "normal",
    requestedBy: "guild-bct",
    evidence: { bct: true, stamp: ctx.stamp },
    now: ctx.now,
  });
  ctx.db.prepare("UPDATE guild_review_queue SET status = 'in_review', assigned_to = ?, updated_at = ? WHERE id = ?").run(
    "guild-bct",
    ctx.now + 1,
    item.id,
  );
  const inReview = one<{ status: string }>(ctx.db, "SELECT status FROM guild_review_queue WHERE id = ?", item.id);
  const decided = decideGuildReviewQueueItem(ctx.db, {
    id: item.id,
    decision: "approved",
    reason: "BCT evidence lifecycle verified.",
    decidedBy: "guild-bct",
    now: ctx.now + 2,
  });
  const pending = listGuildReviewQueue(ctx.db, { guildId: ctx.guildId, status: "pending", limit: 10 });
  return makeStage(
    "Unified Review Queue",
    [inReview?.status === "in_review" ? "pass" : "fail", decided.status === "approved" ? "pass" : "fail"],
    ["created manual review item", "moved to in_review", "decided approved", "listed pending review items"],
    { reviewId: item.id, inReviewStatus: inReview?.status ?? null, finalStatus: decided.status, pendingCount: pending.length },
    "Human review queue lifecycle works.",
  );
}

function stageGovernance(ctx: BctContext): BctStage {
  const roles = ctx.db
    .prepare("SELECT agent_id AS agentId FROM guild_agent_roles WHERE guild_id = ? ORDER BY role_key ASC LIMIT 1")
    .all(ctx.guildId) as Array<{ agentId: string }>;
  let productivityRuns = 0;
  if (roles.length > 0) {
    productivityRuns = scoreGuildProductivityForAllAgents(ctx.db, {
      guildId: ctx.guildId,
      generatedAt: ctx.now,
      reviewDate: new Date(ctx.now).toISOString().slice(0, 10),
    }).length;
  }
  const hrReviews = listGuildHrReviews(ctx.db, ctx.guildId, 10);
  const governance = listGuildGovernanceRequests(ctx.db, ctx.guildId, 10);
  const proposalCount = count(ctx.db, "SELECT COUNT(*) AS count FROM guild_upgrade_proposals WHERE guild_id = ?", ctx.guildId);
  return makeStage(
    "Governance Layer",
    [roles.length > 0 ? "pass" : "warn", productivityRuns > 0 ? "pass" : "warn"],
    ["HR review records listed", "productivity scoring function ran when roles exist", "self-improvement proposal table summarized", "governance requests listed"],
    { productivityRuns, hrReviewCount: hrReviews.length, governanceRequestCount: governance.length, proposalCount },
    productivityRuns > 0 ? "HR and governance summaries are operational." : "Governance tables are available, but no guild roles were scored.",
  );
}

function stageAudit(ctx: BctContext): BctStage {
  const replay = buildGuildAuditReplay(ctx.db, {
    guildId: ctx.guildId,
    generatedAt: ctx.now + 10,
    since: ctx.now - 60_000,
    limit: 80,
  });
  const bctEvents = replay.events.filter((event) => event.title.includes("BCT") || event.detail.includes("BCT"));
  return makeStage(
    "Audit Replay",
    [replay.events.length > 0 ? "pass" : "warn", bctEvents.length > 0 ? "pass" : "warn"],
    ["built audit replay timeline", "BCT events appear in audit evidence when available"],
    { eventCount: replay.events.length, bctEventCount: bctEvents.length, sample: replay.events.slice(0, 8) },
    bctEvents.length > 0 ? "Audit replay includes BCT trace evidence." : "Audit replay works, but BCT trace is sparse.",
  );
}

function stageBackup(ctx: BctContext): BctStage {
  const backupDir = resolveGuildBackupDir(ctx.dbPath);
  const readiness = buildGuildBackupReadiness({
    guildId: ctx.guildId,
    generatedAt: ctx.now,
    dbPath: ctx.dbPath,
    logsDir: ctx.logsDir,
    backupDir,
  });
  const snapshots = listGuildBackupSnapshots(ctx.db, ctx.guildId, 5);
  const latestRestoreProof = snapshots
    .map((snapshot) => parseJsonObject(snapshot.manifest_json).restoreProof)
    .find(Boolean) as Record<string, unknown> | undefined;
  return makeStage(
    "Backup and Restore Readiness",
    [readiness.items.some((item) => item.key === "sqlite_db" && item.exists) ? "pass" : "fail", readiness.backupDirReady ? "pass" : "warn"],
    ["backup readiness manifest generated", "SQLite source exists", "backup directory status summarized", "latest restore-proof metadata summarized"],
    {
      ready: readiness.ready,
      backupDir: readiness.backupDir,
      backupDirReady: readiness.backupDirReady,
      requiredItems: readiness.items.filter((item) => item.required),
      snapshotCount: snapshots.length,
      latestRestoreProof: latestRestoreProof ?? null,
      nextActions: readiness.nextActions,
    },
    readiness.ready ? "Backup readiness is ready." : "Backup readiness is available with setup actions.",
  );
}

function stageSecurity(ctx: BctContext): BctStage {
  const deployment = buildGuildDeploymentReadiness({
    guildId: ctx.guildId,
    generatedAt: ctx.now,
    host: process.env.HOST?.trim() || "127.0.0.1",
    port: Number(process.env.PORT ?? 8790),
    apiAuthToken: process.env.API_AUTH_TOKEN,
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean),
    allowedOriginSuffixes: process.env.ALLOWED_ORIGIN_SUFFIXES?.split(",").map((value) => value.trim()).filter(Boolean),
    logsDir: ctx.logsDir,
    viteDev: process.env.VITE_DEV === "1",
    internetProxyEnabled: process.env.GUILD_AI_HTTPS_PROXY === "1",
  });
  const hardBlocked = deployment.gates.filter((gate) => gate.status === "blocked" && gate.key !== "internet");
  return makeStage(
    "Security Readiness",
    [hardBlocked.length === 0 ? "pass" : "warn"],
    ["deployment readiness generated", "local binding evaluated", "auth/origin/CSRF/audit/internet gates summarized"],
    { mode: deployment.mode, localOnly: deployment.localOnly, readyForLan: deployment.readyForLan, readyForInternet: deployment.readyForInternet, gates: deployment.gates },
    deployment.localOnly ? "Local-only posture is safe for BCT." : "Deployment gates summarized for non-local posture.",
  );
}

function stageCommunity(ctx: BctContext): BctStage {
  const before = count(ctx.db, "SELECT COUNT(*) AS count FROM guild_memory_records WHERE guild_id = ? AND namespace = 'learning'", ctx.guildId);
  const detail = startGuildCommunityLoungeSession(ctx.db, {
    guildId: ctx.guildId,
    topic: `${ctx.bctTag} How can the team improve customer return replies together?`,
    now: ctx.now,
    maxParticipants: 5,
  });
  const afterMemories = listGuildMemories(ctx.db, { guildId: ctx.guildId, namespace: "learning", limit: 5 });
  const newLearning = afterMemories.filter((memory) => memory.created_at >= ctx.now);
  const autoApproved = newLearning.some((memory) => memory.quality_status === "approved");
  return makeStage(
    "Community Lounge",
    [detail.session.status === "failed" ? "fail" : "pass", autoApproved ? "fail" : "pass"],
    ["community session started or safely skipped", "learning messages recorded when enough participants exist", "learning memory is not automatically approved"],
    {
      sessionId: detail.session.id,
      sessionStatus: detail.session.status,
      participantCount: detail.participants.length,
      messageCount: detail.messages.length,
      learningMemoryBefore: before,
      learningMemoryCreated: newLearning.length,
      autoApproved,
    },
    detail.session.status === "skipped" ? "Community Lounge safely skipped due participant availability." : "Community Lounge created learning evidence.",
  );
}

function renderMarkdown(input: {
  timestamp: string;
  commit: string;
  overall: StageStatus;
  ctx: BctContext;
  stages: BctStage[];
}): string {
  const counts = countStatuses(input.stages);
  const stageBlocks = input.stages
    .map((stage) => {
      const checks = stage.checks.map((check) => `- ${check}`).join("\n");
      return `## ${stage.name}

Status: ${stage.status.toUpperCase()}

${stage.message}

Checks:
${checks}

Evidence:

\`\`\`json
${JSON.stringify(stage.evidence, null, 2)}
\`\`\`
`;
    })
    .join("\n");
  const nextAction =
    input.overall === "fail"
      ? "Fix hard-failed stages before tagging or release testing."
      : input.overall === "warn"
        ? "Review warnings, then rerun npm run guild:bct before release."
        : "BCT is clean. Continue release verification or tag preparation.";
  return `# Guild AI BCT Result

Timestamp: ${input.timestamp}
Commit: ${input.commit}
Guild: ${input.ctx.guildId}
DB: ${input.ctx.dbPath}
Host: ${os.hostname()}
Platform: ${process.platform} ${process.arch}
Node: ${process.version}

Overall Verdict: ${input.overall.toUpperCase()}

Counts:

- PASS: ${counts.pass}
- WARN: ${counts.warn}
- FAIL: ${counts.fail}
- SKIPPED: ${counts.skipped}

Next recommended action: ${nextAction}

${stageBlocks}
`;
}

function countStatuses(stages: BctStage[]): Record<StageStatus, number> {
  return {
    pass: stages.filter((stage) => stage.status === "pass").length,
    warn: stages.filter((stage) => stage.status === "warn").length,
    fail: stages.filter((stage) => stage.status === "fail").length,
    skipped: stages.filter((stage) => stage.status === "skipped").length,
  };
}

function overallStatus(stages: BctStage[]): "pass" | "warn" | "fail" {
  if (stages.some((stage) => stage.status === "fail")) return "fail";
  if (stages.some((stage) => stage.status === "warn")) return "warn";
  return "pass";
}

async function main(): Promise<void> {
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });

  const db = new DatabaseSync(dbPath);
  try {
    applyBaseSchema(db);
    applyGuildAiSchema(db);
    seedGuildAiTemplates(db, () => now);

    const ctx: BctContext = { repoRoot, db, dbPath, logsDir, guildId, now, stamp, bctTag };
    const stages: BctStage[] = [];
    stages.push(await runStage("Environment Health", () => stageEnvironment(ctx)));
    stages.push(await runStage("Claw-Empire Compatibility", () => stageClawCompatibility(ctx)));
    stages.push(await runStage("Guild Templates and Runtime Binding", () => stageTemplateRuntime(ctx)));
    stages.push(await runStage("Local Runtime Smoke", () => stageOllama(ctx)));
    stages.push(await runStage("Worker Queue BCT", () => stageWorkerQueue(ctx)));
    stages.push(await runStage("Guild-Aware Routing", () => stageRouting(ctx)));
    stages.push(await runStage("Accounting and Budget Guard", () => stageAccountingBudget(ctx)));
    stages.push(await runStage("Memory and MemoryProvider", () => stageMemory(ctx)));
    stages.push(await runStage("Evaluation Layer", () => stageEvaluation(ctx)));
    stages.push(await runStage("Prompt and Policy Versioning", () => stageVersioning(ctx)));
    stages.push(await runStage("Unified Review Queue", () => stageReviewQueue(ctx)));
    stages.push(await runStage("Governance Layer", () => stageGovernance(ctx)));
    stages.push(await runStage("Audit Replay", () => stageAudit(ctx)));
    stages.push(await runStage("Backup and Restore Readiness", () => stageBackup(ctx)));
    stages.push(await runStage("Security Readiness", () => stageSecurity(ctx)));
    stages.push(await runStage("Community Lounge", () => stageCommunity(ctx)));

    const overall = overallStatus(stages);
    const commit = getCommit(repoRoot);
    const timestamp = new Date(now).toISOString();
    const result = {
      timestamp,
      commit,
      overall,
      guildId,
      dbPath,
      artifactDir,
      stages,
    };

    fs.writeFileSync(path.join(artifactDir, "BCT_RESULT.json"), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(artifactDir, "BCT_RESULT.md"), renderMarkdown({ timestamp, commit, overall, ctx, stages }));

    const counts = countStatuses(stages);
    console.log("Guild AI BCT Result");
    console.log(`PASS: ${counts.pass}`);
    console.log(`WARN: ${counts.warn}`);
    console.log(`FAIL: ${counts.fail}`);
    console.log(`SKIPPED: ${counts.skipped}`);
    console.log(`OVERALL: ${overall.toUpperCase()}`);
    console.log(`Artifacts: ${path.relative(repoRoot, artifactDir)}/BCT_RESULT.md`);
    for (const stage of stages) {
      console.log(`[${stage.status.toUpperCase()}] ${stage.name} - ${stage.message}`);
    }

    process.exitCode = overall === "fail" ? 1 : 0;
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
