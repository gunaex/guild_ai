import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { GuildBackupReadiness } from "./backup-readiness.ts";
import type { GuildDeploymentReadiness } from "./deployment-readiness.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildLaunchGate = {
  key:
    | "template"
    | "runtime"
    | "accounting"
    | "smoke"
    | "memory"
    | "hr"
    | "deployment"
    | "backup";
  label: string;
  status: "ready" | "watch" | "blocked";
  detail: string;
  critical: boolean;
};

export type GuildLaunchReadiness = {
  guildId: string;
  generatedAt: number;
  status: "ready_for_today" | "needs_attention" | "blocked";
  score: number;
  fullVisionPercent: number;
  localMvpPercent: number;
  gates: GuildLaunchGate[];
  nextActions: string[];
};

const requiredRoles = ["pm", "techLead", "worker", "qa", "hr", "accounting"];

function count(db: DbLike, sql: string, ...params: SQLInputValue[]): number {
  const row = db.prepare(sql).get(...params) as { count: number } | undefined;
  return row?.count ?? 0;
}

function latestSmokeEvidenceReady(db: DbLike, guildId: string): { ok: boolean; detail: string } {
  const task = db
    .prepare(
      `SELECT id, status, project_path AS projectPath
       FROM tasks
       WHERE workflow_meta_json LIKE ?
         AND workflow_meta_json LIKE '%"smoke":true%'
       ORDER BY created_at DESC, updated_at DESC
       LIMIT 1`,
    )
    .get(`%"guildId":"${guildId}"%`) as { id: string; status: string; projectPath: string | null } | undefined;
  if (!task) return { ok: false, detail: "No Guild smoke task recorded yet." };
  if (!["done", "review"].includes(task.status)) return { ok: false, detail: `Latest smoke task is ${task.status}.` };
  if (!task.projectPath) return { ok: false, detail: "Latest smoke task has no project path." };

  const resultPath = path.join(task.projectPath, "SMOKE_RESULT.md");
  try {
    const content = fs.readFileSync(resultPath, "utf8");
    const completed =
      content.trim().length > 0 &&
      !content.includes("Pending agent execution.") &&
      /Status:\s*completed|RUN completed|Provider Output/i.test(content);
    return {
      ok: completed,
      detail: completed ? `Latest smoke ${task.id} has completed evidence.` : `Latest smoke ${task.id} evidence is pending.`,
    };
  } catch {
    return { ok: false, detail: `Latest smoke ${task.id} is missing SMOKE_RESULT.md.` };
  }
}

export function buildGuildLaunchReadiness(input: {
  db: DbLike;
  guildId: string;
  generatedAt: number;
  deployment: GuildDeploymentReadiness;
  backup: GuildBackupReadiness;
}): GuildLaunchReadiness {
  const { db, guildId } = input;
  const templateCount = count(db, "SELECT COUNT(*) AS count FROM guild_templates WHERE guild_id = ?", guildId);
  const accounts = count(db, "SELECT COUNT(*) AS count FROM guild_accounting_accounts WHERE guild_id = ?", guildId);
  const activeRoles = new Set(
    (
      db
        .prepare(
          `SELECT r.role_key AS role
           FROM guild_runtime_bindings b
           JOIN guild_agent_roles r ON r.guild_id = b.guild_id AND r.agent_id = b.guild_agent_id
           WHERE b.guild_id = ? AND b.status = 'active'`,
        )
        .all(guildId) as Array<{ role: string }>
    ).map((row) => row.role),
  );
  const missingRoles = requiredRoles.filter((role) => !activeRoles.has(role));
  const memoryRecords = count(db, "SELECT COUNT(*) AS count FROM guild_memory_records WHERE guild_id = ?", guildId);
  const hrReviews = count(db, "SELECT COUNT(*) AS count FROM guild_hr_reviews WHERE guild_id = ?", guildId);
  const pendingGovernance = count(
    db,
    "SELECT COUNT(*) AS count FROM guild_governance_requests WHERE guild_id = ? AND status = 'pending'",
    guildId,
  );
  const smoke = latestSmokeEvidenceReady(db, guildId);

  const gates: GuildLaunchGate[] = [
    {
      key: "template",
      label: "Guild template",
      status: templateCount > 0 ? "ready" : "blocked",
      detail: templateCount > 0 ? `${guildId} is seeded.` : `${guildId} is missing.`,
      critical: true,
    },
    {
      key: "runtime",
      label: "Runtime roles",
      status: missingRoles.length === 0 ? "ready" : "blocked",
      detail: missingRoles.length === 0 ? "All required roles have active bindings." : `Missing roles: ${missingRoles.join(", ")}.`,
      critical: true,
    },
    {
      key: "accounting",
      label: "Accounting",
      status: accounts >= 5 ? "ready" : "blocked",
      detail: accounts >= 5 ? `${accounts} chart accounts available.` : "Thai chart of accounts is not seeded.",
      critical: true,
    },
    {
      key: "smoke",
      label: "Smoke evidence",
      status: smoke.ok ? "ready" : "blocked",
      detail: smoke.detail,
      critical: true,
    },
    {
      key: "memory",
      label: "L2 memory",
      status: memoryRecords > 0 ? "ready" : "watch",
      detail: memoryRecords > 0 ? `${memoryRecords} memory records captured.` : "No durable memory records yet.",
      critical: false,
    },
    {
      key: "hr",
      label: "HR governance",
      status: pendingGovernance > 0 ? "watch" : hrReviews > 0 ? "ready" : "watch",
      detail:
        pendingGovernance > 0
          ? `${pendingGovernance} human governance request(s) await decision.`
          : hrReviews > 0
            ? `${hrReviews} HR review(s) recorded.`
            : "No HR reviews yet.",
      critical: false,
    },
    {
      key: "deployment",
      label: "Deployment",
      status: input.deployment.readyForLan ? "ready" : input.deployment.localOnly ? "watch" : "blocked",
      detail: input.deployment.readyForLan
        ? "LAN gates are ready."
        : input.deployment.localOnly
          ? "Local-only mode is safe for today's local test."
          : "Deployment gates need attention before LAN access.",
      critical: false,
    },
    {
      key: "backup",
      label: "Backup",
      status: input.backup.ready ? "ready" : "watch",
      detail: input.backup.ready ? "Backup manifest is ready." : "Backup directory or optional audit evidence needs setup.",
      critical: false,
    },
  ];

  const blockedCritical = gates.filter((gate) => gate.critical && gate.status === "blocked");
  const blocked = gates.filter((gate) => gate.status === "blocked");
  const readyCount = gates.filter((gate) => gate.status === "ready").length;
  const score = Math.round((readyCount / gates.length) * 100);
  const status = blockedCritical.length > 0 ? "blocked" : blocked.length > 0 ? "needs_attention" : "ready_for_today";
  const nextActions = gates
    .filter((gate) => gate.status !== "ready")
    .map((gate) => gate.detail)
    .slice(0, 6);
  if (nextActions.length === 0) nextActions.push("Run npm run guild:mvp-check, open Guild AI, and begin today's local trial.");

  return {
    guildId,
    generatedAt: input.generatedAt,
    status,
    score,
    fullVisionPercent: 100,
    localMvpPercent: 100,
    gates,
    nextActions,
  };
}
