import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { getGuildVectorMemoryStatus, queryGuildRagMemory } from "./chroma-memory.ts";
import { recordGuildMemory } from "./memory.ts";

describe("Guild AI Chroma L3 memory adapter", () => {
  it("reports sqlite fallback when Chroma is disabled", async () => {
    const status = await getGuildVectorMemoryStatus({ guildId: "ecom-001", provider: "none" });
    expect(status.provider).toBe("sqlite");
    expect(status.ready).toBe(true);
  });

  it("reports Chroma readiness from heartbeat", async () => {
    const status = await getGuildVectorMemoryStatus({
      guildId: "ecom-001",
      provider: "chroma",
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}" }),
    });
    expect(status.provider).toBe("chroma");
    expect(status.ready).toBe(true);
  });

  it("queries SQLite memory as safe RAG fallback", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      applyGuildAiSchema(db);
      recordGuildMemory(db, {
        guildId: "ecom-001",
        namespace: "operations",
        content: "Customer wants a quiet dashboard with daily PM reports.",
        createdAt: 1,
      });
      const result = await queryGuildRagMemory({
        db,
        guildId: "ecom-001",
        query: "dashboard",
        provider: "chroma",
        fetchImpl: async () => {
          throw new Error("offline");
        },
      });
      expect(result.provider).toBe("sqlite");
      expect(result.records).toHaveLength(1);
      expect(result.status.ready).toBe(false);
    } finally {
      db.close();
    }
  });
});
