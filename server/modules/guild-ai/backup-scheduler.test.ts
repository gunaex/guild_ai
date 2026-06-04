import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyBaseSchema } from "../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { listGuildBackupSnapshots, runGuildBackupSnapshot } from "./backup-scheduler.ts";

describe("Guild AI backup scheduler", () => {
  it("creates a snapshot and prunes expired snapshot folders", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-backup-scheduler-"));
    const dbFile = path.join(root, "claw-empire.sqlite");
    const logsDir = path.join(root, "logs");
    const backupDir = path.join(root, "backups");
    const oldDir = path.join(backupDir, "snapshot-old-ecom-001");
    fs.writeFileSync(dbFile, "sqlite-db");
    fs.mkdirSync(logsDir);
    fs.writeFileSync(path.join(logsDir, "security-audit.ndjson"), "audit");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.utimesSync(oldDir, new Date(0), new Date(0));

    const db = new DatabaseSync(":memory:");
    try {
      applyBaseSchema(db);
      applyGuildAiSchema(db);
      db.prepare("INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json) VALUES (?, ?, ?, ?, ?)").run(
        "ecom-001",
        "E-Commerce",
        "ecommerce",
        "USD",
        "{}",
      );

      const result = runGuildBackupSnapshot({
        db,
        guildId: "ecom-001",
        dbPath: dbFile,
        logsDir,
        backupDir,
        retentionDays: 14,
        now: Date.UTC(2026, 5, 5, 8, 0, 0),
      });

      expect(result.snapshot.status).toBe("succeeded");
      expect(result.manifest.files.some((file) => file.key === "sqlite-db")).toBe(true);
      expect(fs.existsSync(oldDir)).toBe(false);
      expect(listGuildBackupSnapshots(db, "ecom-001", 5)).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
