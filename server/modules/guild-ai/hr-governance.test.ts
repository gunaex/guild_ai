import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import {
  decideGuildGovernanceRequest,
  listGuildGovernanceRequests,
  listGuildHrReviews,
  recordGuildHrReview,
} from "./hr-governance.ts";

function seedRole(db: DatabaseSync): void {
  applyGuildAiSchema(db);
  db.prepare(
    "INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json) VALUES (?, ?, ?, ?, ?)",
  ).run("ecom-001", "E-Commerce", "ecommerce", "USD", "{}");
  db.prepare(
    "INSERT INTO guild_agent_roles (guild_id, agent_id, role_key, display_name, model, productivity_floor) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("ecom-001", "worker-001", "worker", "Worker", "local", 70);
}

describe("Guild AI HR governance", () => {
  it("creates a human governance request when productivity falls below floor", () => {
    const db = new DatabaseSync(":memory:");
    const now = Date.UTC(2026, 0, 2);
    try {
      seedRole(db);

      const result = recordGuildHrReview(db, {
        guildId: "ecom-001",
        agentId: "worker-001",
        productivityScore: 42,
        tokenCostUsd: 1.25,
        createdAt: now,
      });

      expect(result.review.productivity_score).toBe(42);
      expect(result.productivityFloor).toBe(70);
      expect(result.governanceRequest).toMatchObject({
        request_type: "termination",
        status: "pending",
      });
      expect(listGuildHrReviews(db, "ecom-001")).toHaveLength(1);
      expect(listGuildGovernanceRequests(db, "ecom-001")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("requires an explicit human decision for governance requests", () => {
    const db = new DatabaseSync(":memory:");
    const now = Date.UTC(2026, 0, 2);
    try {
      seedRole(db);
      const result = recordGuildHrReview(db, {
        guildId: "ecom-001",
        agentId: "worker-001",
        productivityScore: 35,
        createdAt: now,
      });

      const decided = decideGuildGovernanceRequest(db, {
        requestId: result.governanceRequest?.id ?? "",
        decision: "rejected",
        decidedAt: now + 1,
      });

      expect(decided.status).toBe("rejected");
      expect(decided.decided_at).toBe(now + 1);
    } finally {
      db.close();
    }
  });
});
