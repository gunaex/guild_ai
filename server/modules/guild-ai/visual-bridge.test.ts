import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyBaseSchema } from "../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { buildGuildVisualBridgeSnapshot } from "./visual-bridge.ts";

describe("Guild AI visual bridge", () => {
  it("wraps the visual manifest in a renderer subscription snapshot", () => {
    const db = new DatabaseSync(":memory:");
    try {
      applyBaseSchema(db);
      applyGuildAiSchema(db);
      db.prepare(
        "INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("ecom-001", "E-Commerce", "ecommerce", "USD", "{}", 123);

      const snapshot = buildGuildVisualBridgeSnapshot(db, { guildId: "ecom-001", generatedAt: 456 });

      expect(snapshot.version).toBe(1);
      expect(snapshot.subscribeMode).toBe("poll");
      expect(snapshot.sequence).toContain("ecom-001:123");
      expect(snapshot.manifest.scene.key).toBe("local_ai_office");
    } finally {
      db.close();
    }
  });
});
