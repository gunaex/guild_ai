import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { countGuildMemories, listGuildMemories, recordGuildMemory } from "./memory.ts";

describe("Guild AI memory", () => {
  it("records and lists SQLite L2 memory records by namespace", () => {
    const db = new DatabaseSync(":memory:");
    const now = Date.UTC(2026, 0, 2);
    try {
      applyGuildAiSchema(db);

      const memory = recordGuildMemory(db, {
        guildId: "ecom-001",
        namespace: "governance",
        content: "SGM approved sandbox-only runtime experiments.",
        metadata: { sourceType: "test", risk: "low" },
        createdAt: now,
      });

      expect(memory.provider).toBe("sqlite");
      expect(memory.metadata_json).toContain("test");
      expect(countGuildMemories(db, "ecom-001")).toBe(1);
      expect(listGuildMemories(db, { guildId: "ecom-001", namespace: "governance" })).toMatchObject([
        {
          id: memory.id,
          namespace: "governance",
          content: "SGM approved sandbox-only runtime experiments.",
        },
      ]);
      expect(listGuildMemories(db, { guildId: "ecom-001", namespace: "runtime" })).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("rejects empty memory content", () => {
    const db = new DatabaseSync(":memory:");
    try {
      applyGuildAiSchema(db);

      expect(() =>
        recordGuildMemory(db, {
          guildId: "ecom-001",
          namespace: "operations",
          content: "  ",
          createdAt: Date.UTC(2026, 0, 2),
        }),
      ).toThrow("memory content is required");
    } finally {
      db.close();
    }
  });
});
