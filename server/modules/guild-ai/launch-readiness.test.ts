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

function seedLaunchData(db: DatabaseSync, projectPath: string): void {
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
  db.prepare("INSERT INTO guild_accounting_accounts (guild_id, account_code, account_name, account_name_th, category, normal_balance) VALUES (?, ?, ?, ?, ?, ?)").run(
    "ecom-001",
    "1000",
    "Cash",
    "เงินสด",
    "asset",
    "debit",
  );
  db.prepare("INSERT INTO guild_accounting_accounts (guild_id, account_code, account_name, account_name_th, category, normal_balance) VALUES (?, ?, ?, ?, ?, ?)").run(
    "ecom-001",
    "2000",
    "AP",
    "เจ้าหนี้",
    "liability",
    "credit",
  );
  db.prepare("INSERT INTO guild_accounting_accounts (guild_id, account_code, account_name, account_name_th, category, normal_balance) VALUES (?, ?, ?, ?, ?, ?)").run(
    "ecom-001",
    "3000",
    "Capital",
    "ทุน",
    "equity",
    "credit",
  );
  db.prepare("INSERT INTO guild_accounting_accounts (guild_id, account_code, account_name, account_name_th, category, normal_balance) VALUES (?, ?, ?, ?, ?, ?)").run(
    "ecom-001",
    "4000",
    "Revenue",
    "รายได้",
    "revenue",
    "credit",
  );
  db.prepare("INSERT INTO guild_accounting_accounts (guild_id, account_code, account_name, account_name_th, category, normal_balance) VALUES (?, ?, ?, ?, ?, ?)").run(
    "ecom-001",
    "5000",
    "Expense",
    "ค่าใช้จ่าย",
    "expense",
    "debit",
  );
  db.prepare("INSERT INTO guild_memory_records (id, guild_id, provider, namespace, content) VALUES (?, ?, ?, ?, ?)").run(
    "mem-1",
    "ecom-001",
    "sqlite",
    "operations",
    "Launch note",
  );
  db.prepare("INSERT INTO tasks (id, title, status, project_path, workflow_meta_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "smoke-1",
    "Guild smoke",
    "done",
    projectPath,
    JSON.stringify({ guildId: "ecom-001", smoke: true }),
    1,
    1,
  );
}

describe("Guild AI launch readiness", () => {
  it("aggregates critical local launch gates", () => {
    const db = new DatabaseSync(":memory:");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-launch-"));
    const projectPath = path.join(root, "project");
    const dbPath = path.join(root, "claw-empire.sqlite");
    const logsDir = path.join(root, "logs");
    fs.mkdirSync(projectPath);
    fs.mkdirSync(logsDir);
    fs.writeFileSync(path.join(projectPath, "SMOKE_RESULT.md"), "Status: completed\nRUN completed");
    fs.writeFileSync(dbPath, "sqlite");

    try {
      seedLaunchData(db, projectPath);
      const deployment = buildGuildDeploymentReadiness({
        guildId: "ecom-001",
        generatedAt: 1,
        host: "127.0.0.1",
        port: 8790,
        logsDir,
        viteDev: true,
      });
      const backup = buildGuildBackupReadiness({
        guildId: "ecom-001",
        generatedAt: 1,
        dbPath,
        logsDir,
        backupDir: null,
      });

      const readiness = buildGuildLaunchReadiness({ db, guildId: "ecom-001", generatedAt: 1, deployment, backup });

      expect(readiness.status).toBe("ready_for_today");
      expect(readiness.fullVisionPercent).toBe(100);
      expect(readiness.gates.filter((gate) => gate.critical && gate.status === "blocked")).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});
