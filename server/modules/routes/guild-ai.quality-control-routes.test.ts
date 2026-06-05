import express from "express";
import request from "supertest";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { applyBaseSchema } from "../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { registerGuildAiRoutes } from "./guild-ai.ts";

function seed(db: DatabaseSync): void {
  applyBaseSchema(db);
  applyGuildAiSchema(db);
  db.prepare("INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json) VALUES (?, ?, ?, ?, ?)").run(
    "ecom-001",
    "E-Commerce",
    "ecommerce",
    "USD",
    "{}",
  );
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
}

function createHarness() {
  const db = new DatabaseSync(":memory:");
  seed(db);
  const app = express();
  app.use(express.json());
  registerGuildAiRoutes({
    app,
    db,
    dbPath: "/tmp/guild-ai-test.sqlite",
    logsDir: "/tmp",
    nowMs: () => Date.UTC(2026, 5, 5),
  } as never);
  return { app, db };
}

describe("Guild AI quality-control routes", () => {
  it("returns core stability, eval, review, version, and memory-provider APIs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } })),
    );
    const { app, db } = createHarness();
    try {
      const core = await request(app).get("/api/guild-ai/core-stability?guildId=ecom-001").expect(200);
      expect(core.body.summary.gates.map((gate: { key: string }) => gate.key)).toContain("server");

      const evalCase = await request(app)
        .post("/api/guild-ai/evals/cases")
        .send({
          guildId: "ecom-001",
          name: "Route eval",
          taskDescription: "Check evidence discipline",
          expectedBehavior: "Mention evidence",
          rubric: { requiredKeywords: ["evidence"] },
        })
        .expect(200);
      const run = await request(app)
        .post("/api/guild-ai/evals/run")
        .send({
          guildId: "ecom-001",
          caseId: evalCase.body.case.id,
          modelProvider: "ollama",
          modelName: "llama3",
          outputText: "This answer includes evidence.",
        })
        .expect(200);
      expect(run.body.run.verdict).toBe("pass");

      const prompt = await request(app)
        .post("/api/guild-ai/prompt-versions")
        .send({ guildId: "ecom-001", scope: "worker", name: "Worker", version: "1", content: "Use evidence." })
        .expect(200);
      expect((await request(app).post(`/api/guild-ai/prompt-versions/${prompt.body.version.id}/activate`).expect(200)).body.version.status).toBe(
        "active",
      );

      const review = await request(app)
        .post("/api/guild-ai/review-queue")
        .send({ guildId: "ecom-001", reviewType: "manual", title: "Manual", description: "Review me" })
        .expect(200);
      expect((await request(app).post(`/api/guild-ai/review-queue/${review.body.item.id}/decision`).send({ decision: "approved" }).expect(200)).body.item.status).toBe(
        "approved",
      );

      const providers = await request(app).get("/api/guild-ai/memory/providers").expect(200);
      expect(providers.body.defaultProvider).toBe("sqlite");
    } finally {
      db.close();
      vi.unstubAllGlobals();
    }
  });
});
