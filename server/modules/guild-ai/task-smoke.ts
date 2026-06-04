import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { selectGuildRuntimeBindingForRole } from "./runtime-bindings.ts";
import { normalizeSmokeRole, type GuildRuntimeSmokeRole } from "./runtime-smoke.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildTaskSmokeInput = {
  guildId: string;
  roleKey?: unknown;
  scratchRoot?: string | null;
  now: number;
};

export type GuildTaskSmokeResult = {
  guildId: string;
  roleKey: GuildRuntimeSmokeRole;
  projectId: string;
  projectPath: string;
  taskId: string;
  runtimeAgentId: string;
  runtimeAgentName: string;
  status: "planned";
};

export type GuildTaskSmokeRunTarget = {
  taskId: string;
  guildId: string;
  roleKey: GuildRuntimeSmokeRole;
  runtimeAgentId: string;
  runtimeAgentName: string;
  departmentId: string | null;
  projectPath: string;
};

type TaskSmokeRunRow = {
  id: string;
  title: string;
  status: string;
  assigned_agent_id: string | null;
  workflow_meta_json: string | null;
  project_path: string | null;
};

function safeScratchRoot(raw: string | null | undefined): string {
  const fallback = path.join(os.tmpdir(), "guild-ai-task-smoke");
  const candidate = typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
  const resolved = path.resolve(candidate);
  const tmp = path.resolve(os.tmpdir());
  if (resolved !== tmp && !resolved.startsWith(`${tmp}${path.sep}`)) {
    throw new Error("scratchRoot must be inside the system temp directory.");
  }
  return resolved;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeSmokeBrief(projectPath: string, input: { guildId: string; roleKey: string; agentName: string; now: number }): void {
  const brief = [
    "# Guild AI Scratch Smoke",
    "",
    `Guild: ${input.guildId}`,
    `Role: ${input.roleKey}`,
    `Runtime agent: ${input.agentName}`,
    `Created at: ${new Date(input.now).toISOString()}`,
    "",
    "## Scope",
    "",
    "This is a safe scratch project for validating Guild AI task execution.",
    "Do not modify files outside this directory.",
    "",
    "## Task",
    "",
    "1. Inspect this scratch project.",
    "2. Create or update `SMOKE_RESULT.md` with a compact status note.",
    "3. Commit the scratch result normally in the isolated worktree.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(projectPath, "GUILD_SMOKE.md"), brief, "utf8");
  const resultPath = path.join(projectPath, "SMOKE_RESULT.md");
  if (!fs.existsSync(resultPath)) {
    fs.writeFileSync(resultPath, "# Smoke Result\n\nPending agent execution.\n", "utf8");
  }
}

export function resolveGuildTaskSmokeRunTarget(
  db: DbLike,
  input: { guildId: string; taskId: string },
): GuildTaskSmokeRunTarget {
  const guildId = input.guildId.trim();
  const taskId = input.taskId.trim();
  if (!guildId || !taskId) throw new Error("guildId and taskId are required.");

  const task = db
    .prepare("SELECT id, title, status, assigned_agent_id, workflow_meta_json, project_path FROM tasks WHERE id = ?")
    .get(taskId) as TaskSmokeRunRow | undefined;
  if (!task) throw new Error("Task not found.");

  const meta = parseMeta(task.workflow_meta_json);
  if (String(meta.guildId ?? "").trim() !== guildId || meta.smoke !== true) {
    throw new Error("Task is not a Guild AI smoke task.");
  }

  if (!["planned", "pending"].includes(task.status)) {
    throw new Error(`Guild AI smoke task cannot run from status '${task.status}'.`);
  }

  const roleKey = normalizeSmokeRole(String(meta.currentGuildRole ?? meta.roleKey ?? ""));
  const binding = selectGuildRuntimeBindingForRole(db, guildId, roleKey);
  if (!binding) throw new Error(`No active runtime binding found for role '${roleKey}'.`);
  if (binding.availability_status !== "available") {
    throw new Error(`No available runtime binding found for role '${roleKey}'.`);
  }

  const agent = db
    .prepare("SELECT id, name, department_id FROM agents WHERE id = ?")
    .get(binding.runtime_agent_id) as { id: string; name: string; department_id: string | null } | undefined;
  if (!agent) throw new Error(`Runtime agent not found: ${binding.runtime_agent_id}`);

  const projectPath = task.project_path ? path.resolve(task.project_path) : "";
  const tmp = path.resolve(os.tmpdir());
  if (!projectPath || (projectPath !== tmp && !projectPath.startsWith(`${tmp}${path.sep}`))) {
    throw new Error("Guild AI smoke task project path is not inside the system temp directory.");
  }

  return {
    taskId,
    guildId,
    roleKey,
    runtimeAgentId: agent.id,
    runtimeAgentName: agent.name,
    departmentId: agent.department_id,
    projectPath,
  };
}

export function stageGuildTaskSmoke(db: DbLike, input: GuildTaskSmokeInput): GuildTaskSmokeResult {
  const guildId = input.guildId.trim();
  if (!guildId) throw new Error("guildId is required.");

  const roleKey = normalizeSmokeRole(input.roleKey);
  const binding = selectGuildRuntimeBindingForRole(db, guildId, roleKey);
  if (!binding) throw new Error(`No active runtime binding found for role '${roleKey}'.`);
  if (binding.availability_status !== "available") {
    throw new Error(`No available runtime binding found for role '${roleKey}'.`);
  }

  const agent = db
    .prepare("SELECT id, name, department_id FROM agents WHERE id = ?")
    .get(binding.runtime_agent_id) as { id: string; name: string; department_id: string | null } | undefined;
  if (!agent) throw new Error(`Runtime agent not found: ${binding.runtime_agent_id}`);

  const projectId = `guild-smoke-${slug(guildId)}`;
  const projectPath = path.join(safeScratchRoot(input.scratchRoot), slug(guildId));
  fs.mkdirSync(projectPath, { recursive: true });
  writeSmokeBrief(projectPath, { guildId, roleKey, agentName: agent.name, now: input.now });

  db.prepare(
    `INSERT INTO projects (
      id, name, project_path, core_goal, default_pack_key, last_used_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'development', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_path = excluded.project_path,
      core_goal = excluded.core_goal,
      last_used_at = excluded.last_used_at,
      updated_at = excluded.updated_at`,
  ).run(
    projectId,
    `Guild AI Smoke - ${guildId}`,
    projectPath,
    "Safe scratch project for validating Guild AI runtime task execution without touching production repositories.",
    input.now,
    input.now,
    input.now,
  );

  const taskId = randomUUID();
  const title = `Guild AI task smoke (${roleKey})`;
  const description = [
    `[GUILD AI TASK SMOKE] ${guildId}`,
    `Role: ${roleKey}`,
    `Runtime agent: ${agent.name}`,
    "Scratch-only instruction: read GUILD_SMOKE.md, then update SMOKE_RESULT.md with a short status note.",
    "Do not modify the Guild AI source repository or any path outside this scratch project.",
  ].join("\n");

  db.prepare(
    `INSERT INTO tasks (
      id, title, description, department_id, assigned_agent_id, project_id,
      status, priority, task_type, workflow_pack_key, workflow_meta_json, output_format,
      project_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'planned', 1, 'documentation', 'development', ?, 'markdown', ?, ?, ?)`,
  ).run(
    taskId,
    title,
    description,
    agent.department_id,
    agent.id,
    projectId,
    JSON.stringify({ guildId, roleKey, smoke: true }),
    projectPath,
    input.now,
    input.now,
  );

  db.prepare("INSERT INTO task_logs (task_id, kind, message, created_at) VALUES (?, 'system', ?, ?)").run(
    taskId,
    `Guild AI staged safe scratch task smoke for ${agent.name} (${roleKey}) at ${projectPath}`,
    input.now,
  );

  return {
    guildId,
    roleKey,
    projectId,
    projectPath,
    taskId,
    runtimeAgentId: agent.id,
    runtimeAgentName: agent.name,
    status: "planned",
  };
}
