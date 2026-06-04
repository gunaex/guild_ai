import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildGuildBackupReadiness } from "./backup-readiness.ts";

describe("Guild AI backup readiness", () => {
  it("reports ready when DB, logs, and backup directory exist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-backup-ready-"));
    const dbPath = path.join(root, "claw-empire.sqlite");
    const logsDir = path.join(root, "logs");
    const backupDir = path.join(root, "backup");
    fs.writeFileSync(dbPath, "sqlite");
    fs.mkdirSync(logsDir);
    fs.mkdirSync(backupDir);

    const readiness = buildGuildBackupReadiness({
      guildId: "ecom-001",
      generatedAt: Date.UTC(2026, 0, 2),
      dbPath,
      logsDir,
      backupDir,
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.manifest.files.find((file) => file.key === "sqlite_db")?.sizeBytes).toBeGreaterThan(0);
  });

  it("blocks readiness when backup directory is missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-backup-missing-"));
    const dbPath = path.join(root, "claw-empire.sqlite");
    const logsDir = path.join(root, "logs");
    fs.writeFileSync(dbPath, "sqlite");
    fs.mkdirSync(logsDir);

    const readiness = buildGuildBackupReadiness({
      guildId: "ecom-001",
      generatedAt: Date.UTC(2026, 0, 2),
      dbPath,
      logsDir,
      backupDir: path.join(root, "backup"),
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.nextActions.some((action) => action.includes("Create backup directory"))).toBe(true);
  });
});
