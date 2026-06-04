import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyBaseSchema } from "../bootstrap/schema/base-schema.ts";
import { applyGuildAiSchema } from "../bootstrap/schema/guild-ai-schema.ts";
import { buildGuildBackupReadiness } from "./backup-readiness.ts";
import { buildGuildDeploymentReadiness } from "./deployment-readiness.ts";
import { buildGuildLaunchReadiness } from "./launch-readiness.ts";
import {
  generateGuildPmDailyReport,
  getLatestGuildPmDailyReport,
  listGuildPmDailyReports,
  msUntilNextDailyPmReport,
} from "./pm-daily-report.ts";
import { generateDailyPmReportsForAllGuilds } from "./pm-daily-scheduler.ts";

function seedGuild(db: DatabaseSync, projectPath: string): void {
  applyBaseSchema(db);
  applyGuildAiSchema(db);
  db.prepare(
    "INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json) VALUES (?, ?, ?, ?, ?)",
  ).run("ecom-001", "E-Commerce", "ecommerce", "USD", "{}");
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
  db.prepare(
    "INSERT INTO guild_accounting_journal_entries (id, guild_id, entry_date, description, source_type) VALUES (?, ?, ?, ?, ?)",
  ).run("rev-1", "ecom-001", "2026-06-04", "Service revenue", "manual");
  db.prepare(
    "INSERT INTO guild_accounting_journal_lines (entry_id, guild_id, account_code, debit, credit, memo) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("rev-1", "ecom-001", "1000", 25, 0, "cash");
  db.prepare(
    "INSERT INTO guild_accounting_journal_lines (entry_id, guild_id, account_code, debit, credit, memo) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("rev-1", "ecom-001", "4000", 0, 25, "revenue");
  db.prepare(
    "INSERT INTO guild_token_usage (guild_id, agent_id, provider, model, total_tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("ecom-001", "worker-001", "ollama", "llama3", 120, 0.5, 1_780_574_000_000);
  db.prepare("INSERT INTO guild_memory_records (id, guild_id, provider, namespace, content) VALUES (?, ?, ?, ?, ?)").run(
    "mem-1",
    "ecom-001",
    "sqlite",
    "operations",
    "Daily memory",
  );
  db.prepare("INSERT INTO tasks (id, title, status, project_path, workflow_meta_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "smoke-1",
    "Guild smoke",
    "done",
    projectPath,
    JSON.stringify({ guildId: "ecom-001", smoke: true }),
    1_780_574_000_000,
    1_780_574_000_000,
  );
  db.prepare(
    "INSERT INTO guild_backup_snapshots (id, guild_id, backup_dir, retention_days, status, manifest_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "backup-1",
    "ecom-001",
    "/tmp/guild-backup/snapshot-1",
    14,
    "succeeded",
    JSON.stringify({ restoreProof: { status: "verified", integrity: "ok", requiredTablesPresent: true } }),
    1_780_575_000_000,
  );
}

function buildLaunch(db: DatabaseSync, root: string) {
  const projectPath = path.join(root, "project");
  const logsDir = path.join(root, "logs");
  const dbPath = path.join(root, "claw-empire.sqlite");
  fs.mkdirSync(projectPath);
  fs.mkdirSync(logsDir);
  fs.writeFileSync(path.join(projectPath, "SMOKE_RESULT.md"), "Status: completed\nRUN completed");
  fs.writeFileSync(dbPath, "sqlite");
  seedGuild(db, projectPath);
  const generatedAt = 1_780_576_800_000;
  const deployment = buildGuildDeploymentReadiness({
    guildId: "ecom-001",
    generatedAt,
    host: "127.0.0.1",
    port: 8790,
    logsDir,
    viteDev: true,
  });
  const backup = buildGuildBackupReadiness({ guildId: "ecom-001", generatedAt, dbPath, logsDir, backupDir: null });
  return { generatedAt, logsDir, dbPath, launch: buildGuildLaunchReadiness({ db, guildId: "ecom-001", generatedAt, deployment, backup }) };
}

describe("Guild AI PM daily report", () => {
  it("generates and stores a daily PM summary", () => {
    const db = new DatabaseSync(":memory:");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-pm-report-"));
    try {
      const { generatedAt, launch } = buildLaunch(db, root);
      const report = generateGuildPmDailyReport({ db, guildId: "ecom-001", generatedAt, launch, source: "manual" });

      expect(report.reportDate).toBe("2026-06-04");
      expect(report.summary.launchStatus).toBe("ready_for_today");
      expect(report.summary.finance.revenue).toBe(25);
      expect(report.summary.backup.restoreVerified).toBe(true);
      expect(report.markdown).toContain("## Backup");
      expect(report.markdown).toContain("Restore proof: verified");
      expect(report.markdown).toContain("Guild AI Daily PM Report");
      expect(getLatestGuildPmDailyReport(db, "ecom-001")?.id).toBe(report.id);
      expect(listGuildPmDailyReports(db, "ecom-001")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("generates scheduler reports for all guild templates", () => {
    const db = new DatabaseSync(":memory:");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-pm-scheduler-"));
    try {
      const { generatedAt, logsDir, dbPath } = buildLaunch(db, root);
      expect(generateDailyPmReportsForAllGuilds({ db, generatedAt, dbPath, logsDir })).toBe(1);
      expect(getLatestGuildPmDailyReport(db, "ecom-001")?.source).toBe("scheduler");
    } finally {
      db.close();
    }
  });

  it("computes the next daily scheduler delay in Bangkok time", () => {
    const at0700Bangkok = Date.UTC(2026, 5, 4, 0, 0, 0);
    const at0900Bangkok = Date.UTC(2026, 5, 4, 2, 0, 0);
    expect(msUntilNextDailyPmReport(at0700Bangkok)).toBe(60 * 60 * 1000);
    expect(msUntilNextDailyPmReport(at0900Bangkok)).toBe(23 * 60 * 60 * 1000);
  });
});
