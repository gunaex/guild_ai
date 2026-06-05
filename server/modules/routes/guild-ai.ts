import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RuntimeContext } from "../../types/runtime-context.ts";
import {
  getPrepaidAiCreditBalance,
  getProfitAndLossSummary,
  listModelPricing,
  recordAiCreditTopupWithJournal,
  recordServiceRevenueWithJournal,
  recordTokenUsageWithJournal,
  upsertModelPricing,
} from "../guild-ai/accounting-journal.ts";
import { buildGuildBackupReadiness } from "../guild-ai/backup-readiness.ts";
import {
  listGuildBackupSnapshots,
  readGuildBackupRetentionDays,
  resolveGuildBackupDir,
  runGuildBackupSnapshot,
} from "../guild-ai/backup-scheduler.ts";
import { buildGuildSgmBriefing } from "../guild-ai/briefing.ts";
import { buildGuildAuditReplay } from "../guild-ai/audit-replay.ts";
import {
  buildGuildBudgetGuardStatus,
  updateGuildBudgetPolicy,
} from "../guild-ai/budget-guard.ts";
import {
  ALLOWED_ORIGINS,
  ALLOWED_ORIGIN_SUFFIXES,
  API_AUTH_TOKEN,
  HOST,
  PORT,
} from "../../config/runtime.ts";
import {
  buildGuildDeploymentReadiness,
} from "../guild-ai/deployment-readiness.ts";
import { buildGuildLaunchReadiness } from "../guild-ai/launch-readiness.ts";
import { getGuildVectorMemoryStatus, queryGuildRagMemory } from "../guild-ai/chroma-memory.ts";
import { buildGuildCoreStabilitySummary } from "../guild-ai/core-stability.ts";
import {
  getGuildCommunitySessionDetail,
  listGuildCommunityParticipants,
  listGuildCommunitySessions,
  startGuildCommunityLoungeSession,
} from "../guild-ai/community-lounge.ts";
import {
  createGuildEvalCase,
  listGuildEvalCases,
  listGuildEvalRuns,
  runGuildEvalCase,
} from "../guild-ai/evaluations.ts";
import {
  generateGuildPmDailyReport,
  getLatestGuildPmDailyReport,
  listGuildPmDailyReports,
} from "../guild-ai/pm-daily-report.ts";
import { scoreGuildProductivityForAllAgents } from "../guild-ai/productivity-scoring.ts";
import {
  decideGuildGovernanceRequest,
  listGuildGovernanceRequests,
  listGuildHrReviews,
  recordGuildHrReview,
} from "../guild-ai/hr-governance.ts";
import { seedStarterChartOfAccounts, THAI_ACCOUNTING_CATEGORIES } from "../guild-ai/accounting.ts";
import { listAiLimitEvents } from "../guild-ai/limit-events.ts";
import {
  isGuildMemoryNamespace,
  isGuildMemoryQualityStatus,
  isGuildMemoryRiskLevel,
  listGuildMemories,
  recordGuildMemory,
  updateGuildMemoryQuality,
} from "../guild-ai/memory.ts";
import { listMemoryProviders } from "../guild-ai/memory-provider.ts";
import {
  cancelGuildReviewQueueItem,
  createGuildReviewQueueItem,
  decideGuildReviewQueueItem,
  isGuildReviewPriority,
  isGuildReviewType,
  listGuildReviewQueue,
} from "../guild-ai/review-queue.ts";
import {
  bootstrapGuildRuntimeWithOllama,
  listGuildRuntimeBindings,
  selectGuildRuntimeBindingForRole,
} from "../guild-ai/runtime-bindings.ts";
import { buildGuildRuntimeSmokePrompt, normalizeSmokeRole, stripApiProviderEnvelope } from "../guild-ai/runtime-smoke.ts";
import { applyGuildTaskRouteDecision, type GuildTaskRouteDecision } from "../guild-ai/task-routing.ts";
import {
  listRecentGuildTaskSmokes,
  readGuildTaskSmokeArtifacts,
  resolveGuildTaskSmokeRunTarget,
  stageGuildTaskSmoke,
} from "../guild-ai/task-smoke.ts";
import { validateGuildTemplate } from "../guild-ai/templates.ts";
import { buildGuildVisualBridgeSnapshot } from "../guild-ai/visual-bridge.ts";
import { buildGuildVisualManifest } from "../guild-ai/visual-manifest.ts";
import {
  buildGuildWorkerQueueStatus,
  enqueueGuildWorkerJob,
  listGuildWorkerQueue,
  processNextGuildWorkerQueueItem,
} from "../guild-ai/worker-queue.ts";
import {
  activateGuildPolicyVersion,
  activateGuildPromptVersion,
  createGuildPolicyVersion,
  createGuildPromptVersion,
  deprecateGuildPolicyVersion,
  deprecateGuildPromptVersion,
  isPolicyType,
  isPromptScope,
  listGuildPolicyVersions,
  listGuildPromptVersions,
} from "../guild-ai/versioning.ts";
import { insertGuildTemplate } from "../bootstrap/schema/guild-ai-seeds.ts";

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asJson(value: unknown, fallback: unknown): string {
  return JSON.stringify(value ?? fallback);
}

function asCapabilityLevel(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) return fallback;
  return parsed;
}

function asNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function asPositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (value === true || value === "true" || value === "1" || value === 1) return true;
  if (value === false || value === "false" || value === "0" || value === 0) return false;
  return fallback;
}

function isAdviceCategory(value: string): boolean {
  return ["learning", "delegation", "finance", "strategy", "operations", "risk"].includes(value);
}

function isAdvicePriority(value: string): boolean {
  return ["low", "medium", "high", "urgent"].includes(value);
}

function isTaskRouteDecision(value: string): value is GuildTaskRouteDecision {
  return ["worker_done", "qa_pass", "qa_fail", "techlead_escalate"].includes(value);
}

function isGovernanceDecision(value: string): value is "approved" | "rejected" | "cancelled" {
  return ["approved", "rejected", "cancelled"].includes(value);
}

export function registerGuildAiRoutes(ctx: RuntimeContext): void {
  const { app, db, nowMs } = ctx;

  function buildLaunchReadinessForGuild(guildId: string, generatedAt: number) {
    const deployment = buildGuildDeploymentReadiness({
      guildId,
      generatedAt,
      host: HOST,
      port: PORT,
      apiAuthToken: API_AUTH_TOKEN,
      allowedOrigins: ALLOWED_ORIGINS,
      allowedOriginSuffixes: ALLOWED_ORIGIN_SUFFIXES,
      logsDir: ctx.logsDir,
      viteDev: Boolean(process.env.VITE_DEV),
      internetProxyEnabled: process.env.GUILD_AI_HTTPS_PROXY === "1",
    });
    const backup = buildGuildBackupReadiness({
      guildId,
      generatedAt,
      dbPath: ctx.dbPath,
      logsDir: ctx.logsDir,
      backupDir: resolveGuildBackupDir(ctx.dbPath),
    });
    return buildGuildLaunchReadiness({ db, guildId, generatedAt, deployment, backup });
  }

  app.get("/api/guild-ai/health", (_req, res) => {
    const templateCount = db.prepare("SELECT COUNT(*) AS count FROM guild_templates").get() as { count: number };
    const pendingUpgradeCount = db
      .prepare("SELECT COUNT(*) AS count FROM guild_upgrade_proposals WHERE status = 'pending'")
      .get() as { count: number };
    res.json({
      ok: true,
      vectorDbProvider: process.env.VECTOR_DB_PROVIDER ?? "none",
      templates: templateCount.count,
      pendingUpgrades: pendingUpgradeCount.count,
      accountingCategories: THAI_ACCOUNTING_CATEGORIES,
    });
  });

  app.get("/api/guild-ai/core-stability", async (req, res) => {
    const guildId = asText(req.query.guildId) || "ecom-001";
    const generatedAt = nowMs();
    const deployment = buildGuildDeploymentReadiness({
      guildId,
      generatedAt,
      host: HOST,
      port: PORT,
      apiAuthToken: API_AUTH_TOKEN,
      allowedOrigins: ALLOWED_ORIGINS,
      allowedOriginSuffixes: ALLOWED_ORIGIN_SUFFIXES,
      logsDir: ctx.logsDir,
      viteDev: Boolean(process.env.VITE_DEV),
      internetProxyEnabled: process.env.GUILD_AI_HTTPS_PROXY === "1",
    });
    const backup = buildGuildBackupReadiness({
      guildId,
      generatedAt,
      dbPath: ctx.dbPath,
      logsDir: ctx.logsDir,
      backupDir: resolveGuildBackupDir(ctx.dbPath),
    });
    const launch = buildGuildLaunchReadiness({ db, guildId, generatedAt, deployment, backup });
    const budget = buildGuildBudgetGuardStatus(db, guildId, generatedAt);
    const workerQueue = buildGuildWorkerQueueStatus(db, guildId, generatedAt);
    res.json({
      ok: true,
      summary: await buildGuildCoreStabilitySummary({
        db,
        guildId,
        generatedAt,
        launch,
        deployment,
        backup,
        budget,
        workerQueue,
      }),
    });
  });

  app.get("/api/guild-ai/templates", (_req, res) => {
    const templates = db
      .prepare(
        `SELECT guild_id, name, business_type, currency, created_at, updated_at
         FROM guild_templates
         ORDER BY updated_at DESC, guild_id ASC`,
      )
      .all();
    res.json({ ok: true, templates });
  });

  app.get("/api/guild-ai/templates/:guildId", (req, res) => {
    const guildId = req.params.guildId;
    const row = db.prepare("SELECT template_json FROM guild_templates WHERE guild_id = ?").get(guildId) as
      | { template_json: string }
      | undefined;

    if (!row) {
      res.status(404).json({ ok: false, error: "Guild template not found." });
      return;
    }

    res.json({ ok: true, template: JSON.parse(row.template_json) });
  });

  app.post("/api/guild-ai/templates/import", (req, res) => {
    const validation = validateGuildTemplate(req.body);
    if (!validation.ok) {
      res.status(400).json({ ok: false, error: validation.error });
      return;
    }

    const template = validation.template;
    const timestamp = nowMs();

    insertGuildTemplate(db, template, timestamp);

    res.json({ ok: true, guildId: template.guildId, agents: template.agents.length });
  });

  app.get("/api/guild-ai/capabilities/:guildId", (req, res) => {
    const guildId = req.params.guildId;
    const row = db.prepare("SELECT * FROM guild_capability_levels WHERE guild_id = ?").get(guildId);
    res.json({ ok: true, guildId, capability: row ?? null });
  });

  app.get("/api/guild-ai/briefing/:guildId", (req, res) => {
    const guildId = req.params.guildId;
    res.json({ ok: true, briefing: buildGuildSgmBriefing(db, guildId, nowMs()) });
  });

  app.get("/api/guild-ai/audit/:guildId/replay", (req, res) => {
    const guildId = req.params.guildId;
    res.json({
      ok: true,
      replay: buildGuildAuditReplay(db, {
        guildId,
        generatedAt: nowMs(),
        since: asNonNegativeNumber(req.query.since, 0) || undefined,
        limit: asPositiveInt(req.query.limit, 80, 200),
      }),
    });
  });

  app.get("/api/guild-ai/visual/:guildId/manifest", (req, res) => {
    const guildId = req.params.guildId;
    res.json({ ok: true, manifest: buildGuildVisualManifest(db, guildId, nowMs()) });
  });

  app.get("/api/guild-ai/visual/:guildId/bridge-snapshot", (req, res) => {
    const guildId = req.params.guildId;
    res.json({ ok: true, snapshot: buildGuildVisualBridgeSnapshot(db, { guildId, generatedAt: nowMs() }) });
  });

  app.get("/api/guild-ai/community/:guildId/participants", (req, res) => {
    const guildId = req.params.guildId;
    res.json({
      ok: true,
      guildId,
      participants: listGuildCommunityParticipants(db, guildId, asPositiveInt(req.query.limit, 6, 12)),
    });
  });

  app.get("/api/guild-ai/community/:guildId/sessions", (req, res) => {
    const guildId = req.params.guildId;
    res.json({
      ok: true,
      guildId,
      sessions: listGuildCommunitySessions(db, guildId, asPositiveInt(req.query.limit, 10, 50)),
    });
  });

  app.post("/api/guild-ai/community/:guildId/sessions", (req, res) => {
    const guildId = req.params.guildId;
    const body = req.body as Record<string, unknown>;
    try {
      const detail = startGuildCommunityLoungeSession(db, {
        guildId,
        topic: asText(body.topic) || null,
        maxParticipants: asPositiveInt(body.maxParticipants, 5, 8),
        now: nowMs(),
      });
      res.json({ ok: true, guildId, ...detail });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/guild-ai/community/sessions/:sessionId", (req, res) => {
    const detail = getGuildCommunitySessionDetail(db, req.params.sessionId);
    if (!detail) {
      res.status(404).json({ ok: false, error: "Community session not found." });
      return;
    }
    res.json({ ok: true, ...detail });
  });

  app.get("/api/guild-ai/evals/cases", (req, res) => {
    const guildId = asText(req.query.guildId);
    res.json({
      ok: true,
      cases: listGuildEvalCases(db, {
        guildId: guildId || null,
        enabledOnly: asBoolean(req.query.enabledOnly, false),
        limit: asPositiveInt(req.query.limit, 50, 100),
      }),
    });
  });

  app.post("/api/guild-ai/evals/cases", (req, res) => {
    const body = req.body as Record<string, unknown>;
    try {
      const item = createGuildEvalCase(db, {
        guildId: asText(body.guildId),
        name: asText(body.name),
        taskDescription: asText(body.taskDescription),
        expectedBehavior: asText(body.expectedBehavior),
        rubric: body.rubric && typeof body.rubric === "object" ? (body.rubric as Record<string, unknown>) : {},
        tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
        enabled: body.enabled === undefined ? true : asBoolean(body.enabled, true),
        now: nowMs(),
      });
      res.json({ ok: true, case: item });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/guild-ai/evals/run", (req, res) => {
    const body = req.body as Record<string, unknown>;
    try {
      const run = runGuildEvalCase(db, {
        guildId: asText(body.guildId),
        caseId: asText(body.caseId) || null,
        outputText: asText(body.outputText),
        modelProvider: asText(body.modelProvider) || null,
        modelName: asText(body.modelName) || null,
        memorySnapshotId: asText(body.memorySnapshotId) || null,
        now: nowMs(),
      });
      res.json({ ok: true, run });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/guild-ai/evals/runs", (req, res) => {
    res.json({
      ok: true,
      runs: listGuildEvalRuns(db, {
        guildId: asText(req.query.guildId) || null,
        caseId: asText(req.query.caseId) || null,
        limit: asPositiveInt(req.query.limit, 50, 100),
      }),
    });
  });

  app.get("/api/guild-ai/prompt-versions", (req, res) => {
    const guildId = asText(req.query.guildId) || "ecom-001";
    const scope = asText(req.query.scope);
    if (scope && !isPromptScope(scope)) {
      res.status(400).json({ ok: false, error: "invalid prompt scope." });
      return;
    }
    res.json({ ok: true, guildId, versions: listGuildPromptVersions(db, guildId, scope && isPromptScope(scope) ? scope : null) });
  });

  app.post("/api/guild-ai/prompt-versions", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const scope = asText(body.scope);
    if (!isPromptScope(scope)) {
      res.status(400).json({ ok: false, error: "invalid prompt scope." });
      return;
    }
    try {
      res.json({
        ok: true,
        version: createGuildPromptVersion(db, {
          guildId: asText(body.guildId),
          scope,
          name: asText(body.name),
          version: asText(body.version),
          content: typeof body.content === "string" ? body.content : "",
          createdBy: asText(body.createdBy) || null,
          now: nowMs(),
        }),
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/guild-ai/prompt-versions/:id/activate", (req, res) => {
    try {
      res.json({ ok: true, version: activateGuildPromptVersion(db, req.params.id, nowMs()) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/guild-ai/prompt-versions/:id/deprecate", (req, res) => {
    try {
      res.json({ ok: true, version: deprecateGuildPromptVersion(db, req.params.id, nowMs()) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/guild-ai/policy-versions", (req, res) => {
    const guildId = asText(req.query.guildId) || "ecom-001";
    const policyType = asText(req.query.policyType);
    if (policyType && !isPolicyType(policyType)) {
      res.status(400).json({ ok: false, error: "invalid policy type." });
      return;
    }
    res.json({
      ok: true,
      guildId,
      versions: listGuildPolicyVersions(db, guildId, policyType && isPolicyType(policyType) ? policyType : null),
    });
  });

  app.post("/api/guild-ai/policy-versions", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const policyType = asText(body.policyType);
    if (!isPolicyType(policyType)) {
      res.status(400).json({ ok: false, error: "invalid policy type." });
      return;
    }
    try {
      res.json({
        ok: true,
        version: createGuildPolicyVersion(db, {
          guildId: asText(body.guildId),
          policyType,
          name: asText(body.name),
          version: asText(body.version),
          content: body.content && typeof body.content === "object" ? (body.content as Record<string, unknown>) : {},
          createdBy: asText(body.createdBy) || null,
          now: nowMs(),
        }),
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/guild-ai/policy-versions/:id/activate", (req, res) => {
    try {
      res.json({ ok: true, version: activateGuildPolicyVersion(db, req.params.id, nowMs()) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/guild-ai/policy-versions/:id/deprecate", (req, res) => {
    try {
      res.json({ ok: true, version: deprecateGuildPolicyVersion(db, req.params.id, nowMs()) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/guild-ai/review-queue", (req, res) => {
    const reviewType = asText(req.query.reviewType);
    if (reviewType && !isGuildReviewType(reviewType)) {
      res.status(400).json({ ok: false, error: "invalid review type." });
      return;
    }
    res.json({
      ok: true,
      items: listGuildReviewQueue(db, {
        guildId: asText(req.query.guildId) || null,
        status: asText(req.query.status) as never,
        reviewType: reviewType && isGuildReviewType(reviewType) ? reviewType : null,
        limit: asPositiveInt(req.query.limit, 50, 100),
      }),
    });
  });

  app.post("/api/guild-ai/review-queue", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const reviewType = asText(body.reviewType);
    const priority = asText(body.priority) || "normal";
    if (!isGuildReviewType(reviewType) || !isGuildReviewPriority(priority)) {
      res.status(400).json({ ok: false, error: "invalid review type or priority." });
      return;
    }
    try {
      res.json({
        ok: true,
        item: createGuildReviewQueueItem(db, {
          guildId: asText(body.guildId),
          reviewType,
          title: asText(body.title),
          description: asText(body.description),
          sourceTable: asText(body.sourceTable) || null,
          sourceId: asText(body.sourceId) || null,
          priority,
          requestedBy: asText(body.requestedBy) || null,
          assignedTo: asText(body.assignedTo) || null,
          evidence: body.evidence && typeof body.evidence === "object" ? (body.evidence as Record<string, unknown>) : {},
          now: nowMs(),
        }),
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/guild-ai/review-queue/:id/decision", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const decision = asText(body.decision);
    if (!["approved", "rejected", "needs_info"].includes(decision)) {
      res.status(400).json({ ok: false, error: "invalid review decision." });
      return;
    }
    try {
      res.json({
        ok: true,
        item: decideGuildReviewQueueItem(db, {
          id: req.params.id,
          decision: decision as "approved" | "rejected" | "needs_info",
          reason: asText(body.reason) || null,
          decidedBy: asText(body.decidedBy) || null,
          now: nowMs(),
        }),
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/guild-ai/review-queue/:id/cancel", (req, res) => {
    const body = req.body as Record<string, unknown>;
    try {
      res.json({ ok: true, item: cancelGuildReviewQueueItem(db, { id: req.params.id, reason: asText(body.reason) || null, now: nowMs() }) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/guild-ai/deployment/:guildId/readiness", (req, res) => {
    const guildId = req.params.guildId;
    res.json({
      ok: true,
      readiness: buildGuildDeploymentReadiness({
        guildId,
        generatedAt: nowMs(),
        host: HOST,
        port: PORT,
        apiAuthToken: API_AUTH_TOKEN,
        allowedOrigins: ALLOWED_ORIGINS,
        allowedOriginSuffixes: ALLOWED_ORIGIN_SUFFIXES,
        logsDir: ctx.logsDir,
        viteDev: Boolean(process.env.VITE_DEV),
        internetProxyEnabled: process.env.GUILD_AI_HTTPS_PROXY === "1",
      }),
    });
  });

  app.get("/api/guild-ai/backup/:guildId/readiness", (req, res) => {
    const guildId = req.params.guildId;
    res.json({
      ok: true,
      readiness: buildGuildBackupReadiness({
        guildId,
        generatedAt: nowMs(),
        dbPath: ctx.dbPath,
        logsDir: ctx.logsDir,
        backupDir: resolveGuildBackupDir(ctx.dbPath),
      }),
    });
  });

  app.get("/api/guild-ai/backup/:guildId/snapshots", (req, res) => {
    const guildId = req.params.guildId;
    res.json({
      ok: true,
      guildId,
      retentionDays: readGuildBackupRetentionDays(db),
      snapshots: listGuildBackupSnapshots(db, guildId, asPositiveInt(req.query.limit, 10, 50)),
    });
  });

  app.post("/api/guild-ai/backup/:guildId/run", (req, res) => {
    const guildId = req.params.guildId;
    const result = runGuildBackupSnapshot({
      db,
      guildId,
      dbPath: ctx.dbPath,
      logsDir: ctx.logsDir,
      now: nowMs(),
      retentionDays: readGuildBackupRetentionDays(db),
    });
    res.json({ ok: result.snapshot.status === "succeeded", guildId, snapshot: result.snapshot, manifest: result.manifest });
  });

  app.get("/api/guild-ai/budget/:guildId", (req, res) => {
    const guildId = req.params.guildId;
    res.json({ ok: true, guildId, budget: buildGuildBudgetGuardStatus(db, guildId, nowMs()) });
  });

  app.post("/api/guild-ai/budget/:guildId/policy", (req, res) => {
    const guildId = req.params.guildId;
    const body = req.body as Record<string, unknown>;
    try {
      const policy = updateGuildBudgetPolicy(db, {
        guildId,
        dailyBudgetUsd: asNonNegativeNumber(body.dailyBudgetUsd, 10),
        monthlyBudgetUsd: asNonNegativeNumber(body.monthlyBudgetUsd, 300),
        hardStopEnabled: body.hardStopEnabled !== false,
        warnThresholdPercent: asPositiveInt(body.warnThresholdPercent, 80, 100),
        updatedAt: nowMs(),
      });
      res.json({ ok: true, guildId, policy, budget: buildGuildBudgetGuardStatus(db, guildId, nowMs()) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/guild-ai/queue/:guildId", (req, res) => {
    const guildId = req.params.guildId;
    res.json({
      ok: true,
      guildId,
      queue: buildGuildWorkerQueueStatus(db, guildId, nowMs()),
      items: listGuildWorkerQueue(db, guildId, asPositiveInt(req.query.limit, 20, 100)),
    });
  });

  app.post("/api/guild-ai/queue/:guildId/jobs", (req, res) => {
    const guildId = req.params.guildId;
    const body = req.body as Record<string, unknown>;
    try {
      const item = enqueueGuildWorkerJob(db, {
        guildId,
        title: asText(body.title),
        taskId: asText(body.taskId) || null,
        payload: typeof body.payload === "object" && body.payload !== null ? (body.payload as Record<string, unknown>) : {},
        priority: asPositiveInt(body.priority, 3, 5),
        maxAttempts: asPositiveInt(body.maxAttempts, 3, 10),
        now: nowMs(),
      });
      res.json({ ok: true, guildId, item });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/guild-ai/queue/:guildId/process-next", (req, res) => {
    const guildId = req.params.guildId;
    const result = processNextGuildWorkerQueueItem(db, { guildId, now: nowMs() });
    res.status(result.ok ? 200 : 409).json({ ...result, guildId });
  });

  app.get("/api/guild-ai/launch/:guildId/readiness", (req, res) => {
    const guildId = req.params.guildId;
    const generatedAt = nowMs();
    res.json({
      ok: true,
      readiness: buildLaunchReadinessForGuild(guildId, generatedAt),
    });
  });

  app.get("/api/guild-ai/reports/:guildId/daily/latest", (req, res) => {
    const guildId = req.params.guildId;
    res.json({ ok: true, guildId, report: getLatestGuildPmDailyReport(db, guildId) });
  });

  app.get("/api/guild-ai/reports/:guildId/daily", (req, res) => {
    const guildId = req.params.guildId;
    const limit = asPositiveInt(req.query.limit, 14, 60);
    res.json({ ok: true, guildId, reports: listGuildPmDailyReports(db, guildId, limit) });
  });

  app.post("/api/guild-ai/reports/:guildId/daily/generate", (req, res) => {
    const guildId = req.params.guildId;
    const generatedAt = nowMs();
    scoreGuildProductivityForAllAgents(db, { guildId, generatedAt });
    const report = generateGuildPmDailyReport({
      db,
      guildId,
      generatedAt,
      launch: buildLaunchReadinessForGuild(guildId, generatedAt),
      source: "manual",
    });
    res.json({ ok: true, guildId, report });
  });

  app.get("/api/guild-ai/runtime/:guildId/bindings", (req, res) => {
    const guildId = req.params.guildId;
    res.json({ ok: true, guildId, bindings: listGuildRuntimeBindings(db, guildId) });
  });

  app.post("/api/guild-ai/runtime/:guildId/ollama-bootstrap", (req, res) => {
    const guildId = req.params.guildId;
    const body = req.body as Record<string, unknown>;
    try {
      const result = bootstrapGuildRuntimeWithOllama(db, {
        guildId,
        model: asText(body.model) || null,
        assignRuntimeAgents: body.assignRuntimeAgents !== false,
        now: nowMs(),
      });
      res.json({ ok: true, guildId, provider: result.provider, model: result.model, bindings: result.bindings });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/guild-ai/runtime/:guildId/smoke", async (req, res) => {
    const guildId = req.params.guildId;
    const body = req.body as Record<string, unknown>;
    const roleKey = normalizeSmokeRole(body.roleKey);
    const binding = selectGuildRuntimeBindingForRole(db, guildId, roleKey);
    if (!binding) {
      res.status(404).json({ ok: false, error: `No active runtime binding found for role '${roleKey}'.` });
      return;
    }
    if (binding.availability_status !== "available") {
      res.status(409).json({
        ok: false,
        error: `No available runtime binding found for role '${roleKey}'.`,
        activeLimit: binding.active_limit ?? null,
      });
      return;
    }

    const prompt = buildGuildRuntimeSmokePrompt({
      guildId,
      roleKey,
      runtimeAgentName: binding.runtime_agent_name,
      message: asText(body.message) || null,
    });
    const smokeId = randomUUID();
    const logPath = path.join(ctx.logsDir, `guild-runtime-smoke-${guildId}-${roleKey}-${smokeId}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: "w" });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let output = "";

    try {
      await ctx.executeApiProviderAgent(
        prompt,
        process.cwd(),
        logStream,
        controller.signal,
        undefined,
        binding.api_provider_id,
        binding.model,
        (text: string) => {
          output += text;
          logStream.write(text);
          return true;
        },
        binding.runtime_agent_id,
      );
      res.json({
        ok: true,
        guildId,
        roleKey,
        runtimeAgentId: binding.runtime_agent_id,
        runtimeAgentName: binding.runtime_agent_name,
        provider: binding.api_provider_name,
        model: binding.model,
        output: stripApiProviderEnvelope(output),
        logPath,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        guildId,
        roleKey,
        runtimeAgentId: binding.runtime_agent_id,
        runtimeAgentName: binding.runtime_agent_name,
        error: err instanceof Error ? err.message : String(err),
        output: stripApiProviderEnvelope(output),
        logPath,
      });
    } finally {
      clearTimeout(timeout);
      logStream.end();
    }
  });

  app.post("/api/guild-ai/runtime/:guildId/task-smoke", (req, res) => {
    const guildId = req.params.guildId;
    const body = req.body as Record<string, unknown>;
    try {
      const result = stageGuildTaskSmoke(db, {
        guildId,
        roleKey: body.roleKey,
        scratchRoot: asText(body.scratchRoot) || null,
        now: nowMs(),
      });
      ctx.recordTaskCreationAudit({
        taskId: result.taskId,
        taskTitle: `Guild AI task smoke (${result.roleKey})`,
        taskStatus: result.status,
        assignedAgentId: result.runtimeAgentId,
        projectPath: result.projectPath,
        taskType: "documentation",
        trigger: "guild_ai.task_smoke",
        triggerDetail: "POST /api/guild-ai/runtime/:guildId/task-smoke",
        actorType: "api_client",
        req,
        body,
      });
      ctx.broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(result.taskId));
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/guild-ai/runtime/:guildId/task-smokes", (req, res) => {
    const guildId = req.params.guildId;
    try {
      res.json({
        ok: true,
        guildId,
        tasks: listRecentGuildTaskSmokes(db, {
          guildId,
          limit: asNonNegativeNumber(req.query.limit, 10),
        }),
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/guild-ai/tasks/:taskId/run-smoke", (req, res) => {
    const taskId = req.params.taskId;
    const body = req.body as Record<string, unknown>;
    const guildId = asText(body.guildId);
    if (!guildId) {
      res.status(400).json({ ok: false, error: "guildId is required." });
      return;
    }

    try {
      const target = resolveGuildTaskSmokeRunTarget(db, { guildId, taskId });
      const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(target.runtimeAgentId);
      if (!agent) throw new Error(`Runtime agent not found: ${target.runtimeAgentId}`);

      const deptName = target.departmentId ? ctx.getDeptName(target.departmentId) : "Unassigned";
      db.prepare("UPDATE tasks SET assigned_agent_id = ?, status = 'planned', updated_at = ? WHERE id = ?").run(
        target.runtimeAgentId,
        nowMs(),
        taskId,
      );
      ctx.appendTaskLog(taskId, "system", `Guild AI smoke run requested for ${target.runtimeAgentName} (${target.roleKey})`);
      ctx.broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
      ctx.startTaskExecutionForAgent(taskId, agent, target.departmentId, deptName);
      res.json({ ok: true, ...target, status: "started" });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/guild-ai/tasks/:taskId/route-decision", (req, res) => {
    const taskId = req.params.taskId;
    const body = req.body as Record<string, unknown>;
    const guildId = asText(body.guildId);
    const decision = asText(body.decision);

    if (!guildId || !isTaskRouteDecision(decision)) {
      res.status(400).json({
        ok: false,
        error: "guildId and decision are required. decision must be worker_done, qa_pass, qa_fail, or techlead_escalate.",
      });
      return;
    }

    try {
      const result = applyGuildTaskRouteDecision(db, {
        guildId,
        taskId,
        decision,
        feedback: asText(body.feedback) || null,
        maxRetries: asNonNegativeNumber(body.maxRetries, 2),
        now: nowMs(),
      });
      ctx.broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/guild-ai/tasks/:taskId/logs", (req, res) => {
    const taskId = req.params.taskId;
    const task = db
      .prepare(
        `SELECT
          t.id,
          t.title,
          t.status,
          t.assigned_agent_id AS assignedAgentId,
          a.name AS assignedAgentName,
          t.workflow_meta_json AS workflowMetaJson,
          t.project_path AS projectPath,
          t.updated_at AS updatedAt
        FROM tasks t
        LEFT JOIN agents a ON t.assigned_agent_id = a.id
        WHERE t.id = ?`,
      )
      .get(taskId);

    if (!task) {
      res.status(404).json({ ok: false, error: "task_not_found" });
      return;
    }

    const logs = db
      .prepare(
        `SELECT id, kind, message, created_at AS createdAt
         FROM task_logs
         WHERE task_id = ?
         ORDER BY created_at DESC
         LIMIT 20`,
      )
      .all(taskId)
      .reverse();

    res.json({ ok: true, task, logs });
  });

  app.get("/api/guild-ai/tasks/:taskId/artifacts", (req, res) => {
    const taskId = req.params.taskId;
    const guildId = asText(req.query.guildId);
    if (!guildId) {
      res.status(400).json({ ok: false, error: "guildId is required." });
      return;
    }

    try {
      res.json({ ok: true, ...readGuildTaskSmokeArtifacts(db, { guildId, taskId }) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/guild-ai/upgrades/:guildId", (req, res) => {
    const guildId = req.params.guildId;
    const proposals = db
      .prepare(
        `SELECT *
         FROM guild_upgrade_proposals
         WHERE guild_id = ?
         ORDER BY created_at DESC`,
      )
      .all(guildId);
    res.json({ ok: true, guildId, proposals });
  });

  app.post("/api/guild-ai/upgrades/proposals", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const guildId = asText(body.guildId);
    const capabilityArea = asText(body.capabilityArea);
    const title = asText(body.title);
    const rationale = asText(body.rationale);

    if (!guildId || !capabilityArea || !title || !rationale) {
      res.status(400).json({ ok: false, error: "guildId, capabilityArea, title, and rationale are required." });
      return;
    }

    const id = randomUUID();
    const timestamp = nowMs();
    const targetLevel = asCapabilityLevel(body.targetLevel, 2);

    db.prepare(
      `INSERT INTO guild_upgrade_proposals (
        id, guild_id, proposed_by_agent_id, capability_area, target_level, title,
        rationale, risk_json, expected_benefit_json, rollback_plan, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      guildId,
      asText(body.proposedByAgentId) || null,
      capabilityArea,
      targetLevel,
      title,
      rationale,
      asJson(body.risk, {}),
      asJson(body.expectedBenefit, {}),
      asText(body.rollbackPlan) || null,
      timestamp,
      timestamp,
    );

    db.prepare(
      "INSERT INTO guild_upgrade_events (proposal_id, event_type, note, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, "proposed", rationale, asJson({ targetLevel, capabilityArea }, {}), timestamp);

    recordGuildMemory(db, {
      guildId,
      namespace: "governance",
      content: `Upgrade proposal: ${title}. ${rationale}`,
      metadata: { sourceType: "upgrade_proposal", proposalId: id, capabilityArea, targetLevel },
      createdAt: timestamp,
    });

    res.json({ ok: true, proposalId: id, status: "pending" });
  });

  app.post("/api/guild-ai/upgrades/:proposalId/decision", (req, res) => {
    const proposalId = req.params.proposalId;
    const body = req.body as Record<string, unknown>;
    const decision = asText(body.decision);
    const allowed = new Set(["approved", "rejected", "sandbox", "needs_info", "cancelled"]);

    if (!allowed.has(decision)) {
      res.status(400).json({ ok: false, error: "decision must be approved, rejected, sandbox, needs_info, or cancelled." });
      return;
    }

    const timestamp = nowMs();
    const note = asText(body.note);
    const result = db
      .prepare(
        `UPDATE guild_upgrade_proposals
         SET status = ?, human_decision_note = ?, decided_by = ?, decided_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(decision, note || null, asText(body.decidedBy) || "SGM", timestamp, timestamp, proposalId);

    if (result.changes === 0) {
      res.status(404).json({ ok: false, error: "Upgrade proposal not found." });
      return;
    }

    db.prepare(
      "INSERT INTO guild_upgrade_events (proposal_id, event_type, note, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(proposalId, `decision:${decision}`, note || null, asJson(body, {}), timestamp);

    const proposal = db
      .prepare("SELECT guild_id, title FROM guild_upgrade_proposals WHERE id = ?")
      .get(proposalId) as { guild_id: string; title: string } | undefined;
    if (proposal) {
      recordGuildMemory(db, {
        guildId: proposal.guild_id,
        namespace: "governance",
        content: `Upgrade decision: ${decision} for '${proposal.title}'. ${note || "No decision note."}`,
        metadata: { sourceType: "upgrade_decision", proposalId, decision, decidedBy: asText(body.decidedBy) || "SGM" },
        createdAt: timestamp,
      });
    }

    res.json({ ok: true, proposalId, status: decision });
  });

  app.get("/api/guild-ai/upgrades/:proposalId/events", (req, res) => {
    const proposalId = req.params.proposalId;
    const events = db
      .prepare(
        `SELECT id, proposal_id, event_type, note, payload_json, created_at
         FROM guild_upgrade_events
         WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(proposalId);

    res.json({ ok: true, proposalId, events });
  });

  app.get("/api/guild-ai/advice/:guildId", (req, res) => {
    const guildId = req.params.guildId;
    const advice = db
      .prepare(
        `SELECT *
         FROM guild_human_advice
         WHERE guild_id = ?
         ORDER BY
           CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
           created_at DESC`,
      )
      .all(guildId);
    res.json({ ok: true, guildId, advice });
  });

  app.post("/api/guild-ai/advice", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const guildId = asText(body.guildId);
    const title = asText(body.title);
    const recommendation = asText(body.recommendation);
    const category = asText(body.category) || "operations";
    const priority = asText(body.priority) || "medium";

    if (!guildId || !title || !recommendation) {
      res.status(400).json({ ok: false, error: "guildId, title, and recommendation are required." });
      return;
    }

    if (!isAdviceCategory(category)) {
      res.status(400).json({ ok: false, error: "category must be learning, delegation, finance, strategy, operations, or risk." });
      return;
    }

    if (!isAdvicePriority(priority)) {
      res.status(400).json({ ok: false, error: "priority must be low, medium, high, or urgent." });
      return;
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO guild_human_advice (
        id, guild_id, advisor_agent_id, category, priority, title, recommendation,
        learning_resources_json, evidence_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      guildId,
      asText(body.advisorAgentId) || null,
      category,
      priority,
      title,
      recommendation,
      asJson(body.learningResources, []),
      asJson(body.evidence, {}),
      nowMs(),
    );

    recordGuildMemory(db, {
      guildId,
      namespace: category === "finance" ? "accounting" : category === "learning" ? "learning" : "governance",
      content: `SGM advice: ${title}. ${recommendation}`,
      metadata: { sourceType: "human_advice", adviceId: id, category, priority },
      createdAt: nowMs(),
    });

    res.json({ ok: true, adviceId: id, status: "open" });
  });

  app.get("/api/guild-ai/memory/providers", async (_req, res) => {
    const providers = await Promise.all(
      listMemoryProviders(db).map(async (provider) => ({
        name: provider.name,
        health: await provider.health(),
      })),
    );
    res.json({ ok: true, defaultProvider: "sqlite", providers });
  });

  app.get("/api/guild-ai/memory/:guildId", (req, res) => {
    const guildId = req.params.guildId;
    const namespace = asText(req.query.namespace);
    if (namespace && !isGuildMemoryNamespace(namespace)) {
      res.status(400).json({ ok: false, error: "invalid memory namespace." });
      return;
    }
    const memoryNamespace = namespace && isGuildMemoryNamespace(namespace) ? namespace : null;
    const qualityStatus = asText(req.query.status);
    const riskLevel = asText(req.query.riskLevel);
    if (qualityStatus && !isGuildMemoryQualityStatus(qualityStatus)) {
      res.status(400).json({ ok: false, error: "invalid memory quality status." });
      return;
    }
    if (riskLevel && !isGuildMemoryRiskLevel(riskLevel)) {
      res.status(400).json({ ok: false, error: "invalid memory risk level." });
      return;
    }
    res.json({
      ok: true,
      guildId,
      provider: "sqlite",
      records: listGuildMemories(db, {
        guildId,
        namespace: memoryNamespace,
        qualityStatus: qualityStatus && isGuildMemoryQualityStatus(qualityStatus) ? qualityStatus : null,
        riskLevel: riskLevel && isGuildMemoryRiskLevel(riskLevel) ? riskLevel : null,
        includeArchived: asBoolean(req.query.includeArchived, false),
        limit: asNonNegativeNumber(req.query.limit, 20),
      }),
    });
  });

  app.post("/api/guild-ai/memory/:id/quality", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const qualityStatus = asText(body.qualityStatus);
    const riskLevel = asText(body.riskLevel);
    if (!isGuildMemoryQualityStatus(qualityStatus)) {
      res.status(400).json({ ok: false, error: "invalid memory quality status." });
      return;
    }
    if (riskLevel && !isGuildMemoryRiskLevel(riskLevel)) {
      res.status(400).json({ ok: false, error: "invalid memory risk level." });
      return;
    }
    try {
      const record = updateGuildMemoryQuality(db, {
        id: req.params.id,
        qualityStatus,
        riskLevel: riskLevel && isGuildMemoryRiskLevel(riskLevel) ? riskLevel : null,
        confidenceScore: body.confidenceScore === undefined ? null : asNonNegativeNumber(body.confidenceScore, 0),
        approvedBy: asText(body.approvedBy) || null,
        validUntil: body.validUntil === undefined ? null : asNonNegativeNumber(body.validUntil, 0),
        supersedesMemoryId: asText(body.supersedesMemoryId) || null,
        now: nowMs(),
      });
      if (record.risk_level === "high" || record.risk_level === "critical") {
        createGuildReviewQueueItem(db, {
          guildId: record.guild_id,
          reviewType: "memory_quality",
          title: `Review ${record.risk_level} memory`,
          description: record.content.slice(0, 240),
          sourceTable: "guild_memory_records",
          sourceId: record.id,
          priority: record.risk_level === "critical" ? "urgent" : "high",
          requestedBy: "memory_quality",
          evidence: { qualityStatus: record.quality_status, riskLevel: record.risk_level },
          now: nowMs(),
        });
      }
      res.json({ ok: true, record });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/guild-ai/memory/:guildId/vector-status", async (req, res) => {
    const guildId = req.params.guildId;
    res.json({
      ok: true,
      guildId,
      status: await getGuildVectorMemoryStatus({
        guildId,
        provider: process.env.VECTOR_DB_PROVIDER ?? "none",
        endpoint: process.env.CHROMA_URL ?? null,
      }),
    });
  });

  app.get("/api/guild-ai/memory/:guildId/rag", async (req, res) => {
    const guildId = req.params.guildId;
    const query = asText(req.query.query);
    res.json({
      ok: true,
      guildId,
      result: await queryGuildRagMemory({
        db,
        guildId,
        query,
        limit: asPositiveInt(req.query.limit, 8, 20),
        provider: process.env.VECTOR_DB_PROVIDER ?? "none",
        endpoint: process.env.CHROMA_URL ?? null,
      }),
    });
  });

  app.post("/api/guild-ai/memory", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const guildId = asText(body.guildId);
    const namespace = asText(body.namespace) || "operations";
    const content = asText(body.content);
    if (!guildId || !content) {
      res.status(400).json({ ok: false, error: "guildId and content are required." });
      return;
    }
    if (!isGuildMemoryNamespace(namespace)) {
      res.status(400).json({ ok: false, error: "invalid memory namespace." });
      return;
    }

    try {
      const record = recordGuildMemory(db, {
        guildId,
        namespace,
        content,
        metadata: body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : {},
        sourceType: asText(body.sourceType) || "manual_ui",
        riskLevel: isGuildMemoryRiskLevel(asText(body.riskLevel)) ? asText(body.riskLevel) as never : "normal",
        qualityStatus: isGuildMemoryQualityStatus(asText(body.qualityStatus)) ? asText(body.qualityStatus) as never : "draft",
        createdAt: nowMs(),
      });
      res.json({ ok: true, guildId, record });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/guild-ai/hr/:guildId/reviews", (req, res) => {
    const guildId = req.params.guildId;
    res.json({
      ok: true,
      guildId,
      reviews: listGuildHrReviews(db, guildId, asNonNegativeNumber(req.query.limit, 20)),
    });
  });

  app.post("/api/guild-ai/hr/reviews", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const guildId = asText(body.guildId);
    const agentId = asText(body.agentId);
    if (!guildId || !agentId) {
      res.status(400).json({ ok: false, error: "guildId and agentId are required." });
      return;
    }

    try {
      const result = recordGuildHrReview(db, {
        guildId,
        agentId,
        productivityScore: asNonNegativeNumber(body.productivityScore),
        tokenCostUsd: asNonNegativeNumber(body.tokenCostUsd),
        reviewDate: asText(body.reviewDate) || undefined,
        createdAt: nowMs(),
      });
      recordGuildMemory(db, {
        guildId,
        namespace: "governance",
        content: `HR review: ${agentId} scored ${result.review.productivity_score} with floor ${result.productivityFloor}.`,
        metadata: {
          sourceType: "hr_review",
          reviewId: result.review.id,
          agentId,
          governanceRequestId: result.governanceRequest?.id ?? null,
        },
        createdAt: nowMs(),
      });
      res.json({ ok: true, guildId, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/guild-ai/hr/:guildId/score-daily", (req, res) => {
    const guildId = req.params.guildId;
    try {
      const results = scoreGuildProductivityForAllAgents(db, { guildId, generatedAt: nowMs() });
      recordGuildMemory(db, {
        guildId,
        namespace: "governance",
        content: `Auto productivity scoring completed for ${results.length} Guild agent(s).`,
        metadata: {
          sourceType: "auto_productivity_scoring",
          reviewIds: results.map((result) => result.review.id),
        },
        createdAt: nowMs(),
      });
      res.json({ ok: true, guildId, results });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/guild-ai/governance/:guildId/requests", (req, res) => {
    const guildId = req.params.guildId;
    res.json({
      ok: true,
      guildId,
      requests: listGuildGovernanceRequests(db, guildId, asNonNegativeNumber(req.query.limit, 20)),
    });
  });

  app.post("/api/guild-ai/governance/:requestId/decision", (req, res) => {
    const requestId = req.params.requestId;
    const body = req.body as Record<string, unknown>;
    const decision = asText(body.decision);
    if (!isGovernanceDecision(decision)) {
      res.status(400).json({ ok: false, error: "decision must be approved, rejected, or cancelled." });
      return;
    }

    try {
      const request = decideGuildGovernanceRequest(db, { requestId, decision, decidedAt: nowMs() });
      recordGuildMemory(db, {
        guildId: request.guild_id,
        namespace: "governance",
        content: `Governance decision: ${decision} ${request.request_type} request for ${request.agent_id}.`,
        metadata: { sourceType: "governance_decision", requestId, decision, note: asText(body.note) || null },
        createdAt: nowMs(),
      });
      res.json({ ok: true, request });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/guild-ai/accounting/:guildId", (req, res) => {
    const guildId = req.params.guildId;
    const summary = db
      .prepare(
        `SELECT
           COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
           COALESCE(SUM(completion_tokens), 0) AS completionTokens,
           COALESCE(SUM(total_tokens), 0) AS totalTokens,
           COALESCE(SUM(cost_usd), 0) AS costUsd
         FROM guild_token_usage
         WHERE guild_id = ?`,
      )
      .get(guildId);
    res.json({
      ok: true,
      guildId,
      summary,
      prepaidAiCreditBalance: getPrepaidAiCreditBalance(db, guildId),
      profitAndLoss: getProfitAndLossSummary(db, guildId),
    });
  });

  app.get("/api/guild-ai/limits/:guildId", (req, res) => {
    const guildId = req.params.guildId;
    const limit = asNonNegativeNumber(req.query.limit, 50);
    res.json({ ok: true, guildId, events: listAiLimitEvents(db as any, guildId, limit) });
  });

  app.post("/api/guild-ai/accounting/token-usage", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const guildId = asText(body.guildId);
    const agentId = asText(body.agentId);
    const provider = asText(body.provider);
    const model = asText(body.model);

    if (!guildId || !agentId || !provider || !model) {
      res.status(400).json({ ok: false, error: "guildId, agentId, provider, and model are required." });
      return;
    }

    try {
      const result = recordTokenUsageWithJournal(db, {
        guildId,
        agentId,
        provider,
        model,
        promptTokens: asNonNegativeNumber(body.promptTokens),
        completionTokens: asNonNegativeNumber(body.completionTokens),
        costUsd: body.costUsd === undefined ? null : asNonNegativeNumber(body.costUsd),
        paidFrom: body.paidFrom === "prepaid_ai_credits" ? "prepaid_ai_credits" : "accounts_payable",
        createdAt: nowMs(),
      });

      res.json({ ok: true, guildId, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/guild-ai/accounting/ai-credit-topup", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const guildId = asText(body.guildId);
    const provider = asText(body.provider);
    const description = asText(body.description);

    if (!guildId || !provider || !description) {
      res.status(400).json({ ok: false, error: "guildId, provider, and description are required." });
      return;
    }

    try {
      const result = recordAiCreditTopupWithJournal(db, {
        guildId,
        provider,
        description,
        amountUsd: asNonNegativeNumber(body.amountUsd),
        paidFrom:
          body.paidFrom === "accounts_payable" || body.paidFrom === "owner_capital" ? body.paidFrom : "cash",
        sourceType: asText(body.sourceType) || "manual",
        sourceId: asText(body.sourceId) || null,
        createdAt: nowMs(),
      });

      res.json({ ok: true, guildId, ...result, prepaidAiCreditBalance: getPrepaidAiCreditBalance(db, guildId) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/guild-ai/accounting/:guildId/model-pricing", (req, res) => {
    const guildId = req.params.guildId;
    res.json({ ok: true, guildId, pricing: listModelPricing(db, guildId) });
  });

  app.post("/api/guild-ai/accounting/model-pricing", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const guildId = asText(body.guildId);
    const provider = asText(body.provider);
    const model = asText(body.model);

    if (!guildId || !provider || !model) {
      res.status(400).json({ ok: false, error: "guildId, provider, and model are required." });
      return;
    }

    try {
      const pricing = upsertModelPricing(db, {
        guildId,
        provider,
        model,
        promptUsdPerMillion: asNonNegativeNumber(body.promptUsdPerMillion),
        completionUsdPerMillion: asNonNegativeNumber(body.completionUsdPerMillion),
        source: asText(body.source) || "manual",
        createdAt: nowMs(),
      });
      res.json({ ok: true, guildId, pricing });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/guild-ai/accounting/revenue", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const guildId = asText(body.guildId);
    const description = asText(body.description);

    if (!guildId || !description) {
      res.status(400).json({ ok: false, error: "guildId and description are required." });
      return;
    }

    try {
      const result = recordServiceRevenueWithJournal(db, {
        guildId,
        customerName: asText(body.customerName) || null,
        description,
        amountUsd: asNonNegativeNumber(body.amountUsd),
        receivedTo: body.receivedTo === "accounts_receivable" ? "accounts_receivable" : "cash",
        sourceType: asText(body.sourceType) || "manual",
        sourceId: asText(body.sourceId) || null,
        createdAt: nowMs(),
      });

      recordGuildMemory(db, {
        guildId,
        namespace: "accounting",
        content: `Revenue recorded: ${description} for $${result.amountUsd.toFixed(2)}.`,
        metadata: {
          sourceType: "service_revenue",
          revenueId: result.revenueId,
          customerName: asText(body.customerName) || null,
          receivedTo: body.receivedTo === "accounts_receivable" ? "accounts_receivable" : "cash",
        },
        createdAt: nowMs(),
      });

      res.json({ ok: true, guildId, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/guild-ai/accounting/:guildId/pnl", (req, res) => {
    const guildId = req.params.guildId;
    res.json({ ok: true, ...getProfitAndLossSummary(db, guildId) });
  });

  app.get("/api/guild-ai/accounting/:guildId/journal", (req, res) => {
    const guildId = req.params.guildId;
    const entries = db
      .prepare(
        `SELECT id, entry_date, description, source_type, source_id, created_at
         FROM guild_accounting_journal_entries
         WHERE guild_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
      )
      .all(guildId) as Array<{ id: string }>;
    const lines = db
      .prepare(
        `SELECT l.entry_id, l.account_code, a.account_name_th, a.category, l.debit, l.credit, l.memo
         FROM guild_accounting_journal_lines l
         JOIN guild_accounting_accounts a
           ON a.guild_id = l.guild_id AND a.account_code = l.account_code
         WHERE l.guild_id = ?
         ORDER BY l.id ASC`,
      )
      .all(guildId) as Array<{ entry_id: string }>;

    res.json({
      ok: true,
      guildId,
      entries: entries.map((entry) => ({
        ...entry,
        lines: lines.filter((line) => line.entry_id === entry.id),
      })),
    });
  });

  app.get("/api/guild-ai/accounting/:guildId/accounts", (req, res) => {
    const guildId = req.params.guildId;
    seedStarterChartOfAccounts(db, guildId);
    const accounts = db
      .prepare(
        `SELECT account_code, account_name, account_name_th, category, normal_balance, is_active
         FROM guild_accounting_accounts
         WHERE guild_id = ?
         ORDER BY account_code ASC`,
      )
      .all(guildId);

    res.json({ ok: true, guildId, categories: THAI_ACCOUNTING_CATEGORIES, accounts });
  });
}
