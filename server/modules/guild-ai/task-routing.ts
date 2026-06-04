import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { selectGuildRuntimeBindingForRole } from "./runtime-bindings.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildTaskRouteDecision =
  | "worker_done"
  | "qa_pass"
  | "qa_fail"
  | "techlead_escalate";

export type GuildTaskRouteResult = {
  taskId: string;
  guildId: string;
  decision: GuildTaskRouteDecision;
  status: "planned" | "review" | "done";
  assignedAgentId: string | null;
  assignedRole: "worker" | "qa" | "techLead" | "pm" | null;
  retryCount: number;
  escalationLevel: "techLead" | "pm" | null;
};

type TaskRow = {
  id: string;
  title: string;
  status: string;
  workflow_meta_json: string | null;
  project_path: string | null;
};

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asRetryCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function bindingForRole(db: DbLike, guildId: string, role: "worker" | "qa" | "techLead" | "pm") {
  const binding = selectGuildRuntimeBindingForRole(db, guildId, role);
  return binding?.availability_status === "available" ? binding : null;
}

function appendTaskLog(db: DbLike, taskId: string, message: string, now: number): void {
  db.prepare("INSERT INTO task_logs (task_id, kind, message, created_at) VALUES (?, 'system', ?, ?)").run(
    taskId,
    message,
    now,
  );
}

function hasCompletedSmokeResult(task: TaskRow): boolean {
  const meta = parseMeta(task.workflow_meta_json);
  if (meta.smoke !== true) return true;

  const projectPath = task.project_path ? path.resolve(task.project_path) : "";
  const tmp = path.resolve(os.tmpdir());
  if (!projectPath || (projectPath !== tmp && !projectPath.startsWith(`${tmp}${path.sep}`))) return false;

  const resultPath = path.join(projectPath, "SMOKE_RESULT.md");
  if (!fs.existsSync(resultPath)) return false;
  const content = fs.readFileSync(resultPath, "utf8").trim();
  return Boolean(content) && !content.includes("Pending agent execution.");
}

export function applyGuildTaskRouteDecision(
  db: DbLike,
  input: {
    guildId: string;
    taskId: string;
    decision: GuildTaskRouteDecision;
    feedback?: string | null;
    maxRetries?: number;
    now: number;
  },
): GuildTaskRouteResult {
  const guildId = input.guildId.trim();
  const taskId = input.taskId.trim();
  if (!guildId || !taskId) throw new Error("guildId and taskId are required.");

  const task = db
    .prepare("SELECT id, title, status, workflow_meta_json, project_path FROM tasks WHERE id = ?")
    .get(taskId) as TaskRow | undefined;
  if (!task) throw new Error("Task not found.");

  const meta = parseMeta(task.workflow_meta_json);
  const currentRetryCount = asRetryCount(meta.retryCount);
  const maxRetries = Math.max(0, Math.trunc(Number(input.maxRetries ?? 2)));
  const feedback = input.feedback?.trim() || null;

  let nextStatus: GuildTaskRouteResult["status"];
  let nextRole: GuildTaskRouteResult["assignedRole"];
  let retryCount = currentRetryCount;
  let escalationLevel: GuildTaskRouteResult["escalationLevel"] = null;

  if (input.decision === "worker_done") {
    nextStatus = "review";
    nextRole = "qa";
  } else if (input.decision === "qa_pass") {
    if (!hasCompletedSmokeResult(task)) {
      throw new Error("Guild AI smoke QA pass requires a completed SMOKE_RESULT.md artifact.");
    }
    nextStatus = "done";
    nextRole = null;
  } else if (input.decision === "qa_fail") {
    if (currentRetryCount < maxRetries) {
      nextStatus = "planned";
      nextRole = "worker";
      retryCount = currentRetryCount + 1;
    } else {
      nextStatus = "planned";
      nextRole = "techLead";
      escalationLevel = "techLead";
    }
  } else {
    nextStatus = "planned";
    nextRole = "pm";
    escalationLevel = "pm";
  }

  const binding = nextRole ? bindingForRole(db, guildId, nextRole) : null;
  if (nextRole && !binding) throw new Error(`No active runtime binding found for role '${nextRole}'.`);
  const assignedAgentId = binding?.runtime_agent_id ?? null;

  const nextMeta = {
    ...meta,
    guildId,
    routeDecision: input.decision,
    currentGuildRole: nextRole,
    retryCount,
    maxRetries,
    escalationLevel,
    lastQaFeedback: feedback,
    routedAt: input.now,
  };

  db.prepare(
    `UPDATE tasks
     SET status = ?, assigned_agent_id = ?, workflow_meta_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(nextStatus, assignedAgentId, JSON.stringify(nextMeta), input.now, taskId);

  appendTaskLog(
    db,
    taskId,
    `Guild AI route decision '${input.decision}' -> ${nextStatus}${nextRole ? `/${nextRole}` : ""}${
      feedback ? ` | ${feedback}` : ""
    }`,
    input.now,
  );

  return {
    taskId,
    guildId,
    decision: input.decision,
    status: nextStatus,
    assignedAgentId,
    assignedRole: nextRole,
    retryCount,
    escalationLevel,
  };
}
