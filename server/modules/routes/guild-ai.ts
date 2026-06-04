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
import { buildGuildSgmBriefing } from "../guild-ai/briefing.ts";
import { seedStarterChartOfAccounts, THAI_ACCOUNTING_CATEGORIES } from "../guild-ai/accounting.ts";
import { listAiLimitEvents } from "../guild-ai/limit-events.ts";
import {
  bootstrapGuildRuntimeWithOllama,
  listGuildRuntimeBindings,
  selectGuildRuntimeBindingForRole,
} from "../guild-ai/runtime-bindings.ts";
import { buildGuildRuntimeSmokePrompt, normalizeSmokeRole, stripApiProviderEnvelope } from "../guild-ai/runtime-smoke.ts";
import { applyGuildTaskRouteDecision, type GuildTaskRouteDecision } from "../guild-ai/task-routing.ts";
import { readGuildTaskSmokeArtifacts, resolveGuildTaskSmokeRunTarget, stageGuildTaskSmoke } from "../guild-ai/task-smoke.ts";
import { validateGuildTemplate } from "../guild-ai/templates.ts";
import { buildGuildVisualManifest } from "../guild-ai/visual-manifest.ts";
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

function isAdviceCategory(value: string): boolean {
  return ["learning", "delegation", "finance", "strategy", "operations", "risk"].includes(value);
}

function isAdvicePriority(value: string): boolean {
  return ["low", "medium", "high", "urgent"].includes(value);
}

function isTaskRouteDecision(value: string): value is GuildTaskRouteDecision {
  return ["worker_done", "qa_pass", "qa_fail", "techlead_escalate"].includes(value);
}

export function registerGuildAiRoutes(ctx: RuntimeContext): void {
  const { app, db, nowMs } = ctx;

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

  app.get("/api/guild-ai/visual/:guildId/manifest", (req, res) => {
    const guildId = req.params.guildId;
    res.json({ ok: true, manifest: buildGuildVisualManifest(db, guildId, nowMs()) });
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

    res.json({ ok: true, adviceId: id, status: "open" });
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
