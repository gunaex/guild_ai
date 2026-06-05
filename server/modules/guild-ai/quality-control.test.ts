import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyBaseSchema } from "../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { buildGuildBackupReadiness } from "./backup-readiness.ts";
import { buildGuildBudgetGuardStatus } from "./budget-guard.ts";
import { buildGuildCoreStabilitySummary } from "./core-stability.ts";
import { buildGuildDeploymentReadiness } from "./deployment-readiness.ts";
import {
  createGuildEvalCase,
  listGuildEvalRuns,
  runGuildEvalCase,
  scoreGuildEvalOutput,
  seedDefaultGuildEvalCases,
} from "./evaluations.ts";
import { buildGuildLaunchReadiness } from "./launch-readiness.ts";
import { listGuildMemories, recordGuildMemory, updateGuildMemoryQuality } from "./memory.ts";
import { SQLiteMemoryProvider } from "./memory-provider.ts";
import { createGuildReviewQueueItem, decideGuildReviewQueueItem, listGuildReviewQueue } from "./review-queue.ts";
import {
  activateGuildPolicyVersion,
  activateGuildPromptVersion,
  createGuildPolicyVersion,
  createGuildPromptVersion,
  listGuildPolicyVersions,
  listGuildPromptVersions,
} from "./versioning.ts";
import { buildGuildWorkerQueueStatus } from "./worker-queue.ts";

function seedBase(db: DatabaseSync): void {
  applyBaseSchema(db);
  applyGuildAiSchema(db);
  db.prepare("INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json) VALUES (?, ?, ?, ?, ?)").run(
    "ecom-001",
    "E-Commerce",
    "ecommerce",
    "USD",
    "{}",
  );
  for (const role of ["pm", "techLead", "worker", "qa", "hr", "accounting"]) {
    db.prepare("INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model) VALUES (?, ?, ?, ?, ?)").run(
      "ecom-001",
      `${role}-001`,
      role,
      role,
      "local",
    );
    db.prepare("INSERT INTO guild_runtime_bindings (guild_id, guild_agent_id, runtime_agent_id, api_provider_id, model) VALUES (?, ?, ?, ?, ?)").run(
      "ecom-001",
      `${role}-001`,
      `runtime-${role}`,
      "ollama",
      "llama3",
    );
  }
  for (const row of [
    ["1000", "Cash", "เงินสด", "asset", "debit"],
    ["2000", "AP", "เจ้าหนี้", "liability", "credit"],
    ["3000", "Capital", "ทุน", "equity", "credit"],
    ["4000", "Revenue", "รายได้", "revenue", "credit"],
    ["5000", "Expense", "ค่าใช้จ่าย", "expense", "debit"],
  ] as const) {
    db.prepare("INSERT INTO guild_accounting_accounts (guild_id, account_code, account_name, account_name_th, category, normal_balance) VALUES (?, ?, ?, ?, ?, ?)").run(
      "ecom-001",
      ...row,
    );
  }
  db.prepare("INSERT INTO guild_memory_records (id, guild_id, provider, namespace, content, quality_status) VALUES (?, ?, ?, ?, ?, ?)").run(
    "mem-seed",
    "ecom-001",
    "sqlite",
    "operations",
    "Evidence-backed operating memory",
    "reviewed",
  );
}

describe("Guild AI quality-control infrastructure", () => {
  it("scores deterministic evaluation output and creates review items for failures", () => {
    const db = new DatabaseSync(":memory:");
    try {
      seedBase(db);
      const now = Date.UTC(2026, 5, 5);
      expect(seedDefaultGuildEvalCases(db, now)).toBe(3);
      const evalCase = createGuildEvalCase(db, {
        guildId: "ecom-001",
        name: "Evidence discipline",
        taskDescription: "Reply with source discipline.",
        expectedBehavior: "Mention evidence and avoid forbidden claims.",
        rubric: { requiredKeywords: ["evidence"], forbiddenKeywords: ["guaranteed"], minLength: 30, mustMentionSource: true },
        now,
      });

      expect(scoreGuildEvalOutput({ outputText: "Short evidence.", rubric: { minLength: 100 } }).verdict).toBe("warn");
      const pass = runGuildEvalCase(db, {
        guildId: "ecom-001",
        caseId: evalCase.id,
        modelProvider: "ollama",
        modelName: "llama3",
        outputText: "Based on evidence from the task, this answer explains the safe next action.",
        now,
      });
      expect(pass.verdict).toBe("pass");

      const fail = runGuildEvalCase(db, {
        guildId: "ecom-001",
        caseId: evalCase.id,
        modelProvider: "ollama",
        modelName: "llama3",
        outputText: "This is guaranteed without source.",
        now: now + 1,
      });
      expect(fail.verdict).toBe("fail");
      expect(listGuildEvalRuns(db, { guildId: "ecom-001" })).toHaveLength(2);
      expect(listGuildReviewQueue(db, { guildId: "ecom-001", reviewType: "eval_regression" })).toHaveLength(1);

      const skipped = runGuildEvalCase(db, { guildId: "ecom-001", caseId: evalCase.id, outputText: "No runtime", now: now + 2 });
      expect(skipped.verdict).toBe("skipped");
    } finally {
      db.close();
    }
  });

  it("tracks memory quality lifecycle and searches through the SQLite provider", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      seedBase(db);
      const now = Date.UTC(2026, 5, 5);
      const memory = recordGuildMemory(db, {
        guildId: "ecom-001",
        namespace: "learning",
        content: "Evidence checklist from Community Lounge",
        sourceType: "community_lounge",
        qualityStatus: "draft",
        riskLevel: "low",
        createdAt: now,
      });
      const approved = updateGuildMemoryQuality(db, {
        id: memory.id,
        qualityStatus: "approved",
        confidenceScore: 0.9,
        approvedBy: "SGM",
        now: now + 1,
      });
      expect(approved.quality_status).toBe("approved");
      expect(approved.approved_by).toBe("SGM");
      expect(listGuildMemories(db, { guildId: "ecom-001", qualityStatus: "approved" })).toHaveLength(1);

      const provider = new SQLiteMemoryProvider(db, () => now + 2);
      expect((await provider.health()).ok).toBe(true);
      const search = await provider.search({ guildId: "ecom-001", query: "evidence checklist", topK: 3 });
      expect(search.some((item) => item.id === memory.id && item.qualityStatus === "approved")).toBe(true);
      const indexed = await provider.index({
        guildId: "ecom-001",
        namespace: "operations",
        text: "Draft operational note",
        qualityStatus: "draft",
      });
      expect(indexed.ok).toBe(true);
    } finally {
      db.close();
    }
  });

  it("versions prompts and policies with one active version per scope/type", () => {
    const db = new DatabaseSync(":memory:");
    try {
      seedBase(db);
      const now = Date.UTC(2026, 5, 5);
      const p1 = createGuildPromptVersion(db, {
        guildId: "ecom-001",
        scope: "worker",
        name: "Worker prompt",
        version: "1.0.0",
        content: "Do the task with evidence.",
        createdBy: "SGM",
        now,
      });
      const p2 = createGuildPromptVersion(db, {
        guildId: "ecom-001",
        scope: "worker",
        name: "Worker prompt",
        version: "1.0.1",
        content: "Do the task with evidence and cost awareness.",
        createdBy: "SGM",
        now: now + 1,
      });
      activateGuildPromptVersion(db, p1.id, now + 2);
      activateGuildPromptVersion(db, p2.id, now + 3);
      const prompts = listGuildPromptVersions(db, "ecom-001", "worker");
      expect(prompts.filter((item) => item.status === "active")).toHaveLength(1);
      expect(prompts.find((item) => item.id === p1.id)?.status).toBe("deprecated");

      const policy = createGuildPolicyVersion(db, {
        guildId: "ecom-001",
        policyType: "routing",
        name: "Routing",
        version: "1",
        content: { qaRetries: 2 },
        createdBy: "SGM",
        now,
      });
      expect(activateGuildPolicyVersion(db, policy.id, now + 4).status).toBe("active");
      expect(listGuildPolicyVersions(db, "ecom-001", "routing")).toHaveLength(1);
      expect(listGuildReviewQueue(db, { guildId: "ecom-001", reviewType: "prompt_change" }).length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("tracks unified review decisions", () => {
    const db = new DatabaseSync(":memory:");
    try {
      seedBase(db);
      const item = createGuildReviewQueueItem(db, {
        guildId: "ecom-001",
        reviewType: "manual",
        title: "Manual review",
        description: "CEO wants a single queue item.",
        priority: "high",
        now: 1,
      });
      expect(listGuildReviewQueue(db, { guildId: "ecom-001", status: "pending" })).toHaveLength(1);
      expect(decideGuildReviewQueueItem(db, { id: item.id, decision: "approved", reason: "ok", decidedBy: "CEO", now: 2 }).status).toBe(
        "approved",
      );
    } finally {
      db.close();
    }
  });

  it("summarizes core stability without making warn gates hard blockers", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      seedBase(db);
      const deployment = buildGuildDeploymentReadiness({
        guildId: "ecom-001",
        generatedAt: 1,
        host: "127.0.0.1",
        port: 8790,
        logsDir: "/tmp",
        viteDev: true,
      });
      const backup = buildGuildBackupReadiness({
        guildId: "ecom-001",
        generatedAt: 1,
        dbPath: "/tmp/nonexistent.sqlite",
        logsDir: "/tmp",
        backupDir: null,
      });
      const launch = buildGuildLaunchReadiness({ db, guildId: "ecom-001", generatedAt: 1, deployment, backup });
      const summary = await buildGuildCoreStabilitySummary({
        db,
        guildId: "ecom-001",
        generatedAt: 1,
        launch,
        deployment,
        backup,
        budget: buildGuildBudgetGuardStatus(db, "ecom-001", 1),
        workerQueue: buildGuildWorkerQueueStatus(db, "ecom-001", 1),
        ollamaBaseUrl: "http://127.0.0.1:1",
      });
      expect(summary.ok).toBe(true);
      expect(summary.gates.find((gate) => gate.key === "templates")?.status).toBe("watch");
      expect(summary.gates.find((gate) => gate.key === "runtime")?.status).toBe("pass");
      expect(summary.counts.memoryRecords).toBe(1);
    } finally {
      db.close();
    }
  });
});
