import type { DatabaseSync } from "node:sqlite";
import { getProfitAndLossSummary } from "./accounting-journal.ts";
import { listGuildRuntimeBindings } from "./runtime-bindings.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildVisualMood = "warming_up" | "profitable" | "cost_watch" | "needs_decision" | "running";

export type GuildVisualManifest = {
  guildId: string;
  generatedAt: number;
  scene: {
    key: "local_ai_office";
    title: string;
    mood: GuildVisualMood;
    palette: {
      background: string;
      accent: string;
      warning: string;
    };
  };
  actors: Array<{
    guildAgentId: string;
    roleKey: string;
    displayName: string;
    runtimeAgentId: string;
    runtimeName: string;
    providerName: string;
    model: string;
    status: string;
    visualState: "idle" | "ready" | "offline";
  }>;
  accounting: {
    revenue: number;
    expenses: number;
    netIncome: number;
    visualState: "profit" | "loss" | "neutral";
  };
  governance: {
    pendingUpgrades: number;
    latestAdvice: string | null;
    visualState: "clear" | "decision_needed";
  };
  tasks: {
    planned: number;
    inProgress: number;
    review: number;
    done: number;
    visualState: "quiet" | "active" | "reviewing";
  };
};

function chooseMood(input: {
  runtimeBindingCount: number;
  pendingUpgrades: number;
  netIncome: number;
  inProgress: number;
}): GuildVisualMood {
  if (input.runtimeBindingCount === 0) return "warming_up";
  if (input.pendingUpgrades > 0) return "needs_decision";
  if (input.inProgress > 0) return "running";
  if (input.netIncome < 0) return "cost_watch";
  if (input.netIncome > 0) return "profitable";
  return "running";
}

export function buildGuildVisualManifest(db: DbLike, guildId: string, generatedAt: number): GuildVisualManifest {
  const bindings = listGuildRuntimeBindings(db, guildId);
  const pnl = getProfitAndLossSummary(db, guildId);
  const pendingUpgradeRow = db
    .prepare("SELECT COUNT(*) AS count FROM guild_upgrade_proposals WHERE guild_id = ? AND status = 'pending'")
    .get(guildId) as { count: number } | undefined;
  const adviceRow = db
    .prepare(
      `SELECT title
       FROM guild_human_advice
       WHERE guild_id = ? AND status = 'open'
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(guildId) as { title: string } | undefined;
  const taskRows = db
    .prepare(
      `SELECT status, COUNT(*) AS count
       FROM tasks
       WHERE project_id = ? OR project_id LIKE ?
       GROUP BY status`,
    )
    .all(`guild-smoke-${guildId}`, `guild-%-${guildId}`) as Array<{ status: string; count: number }>;

  const taskCount = (status: string): number => Number(taskRows.find((row) => row.status === status)?.count ?? 0);
  const planned = taskCount("planned");
  const inProgress = taskCount("in_progress") + taskCount("collaborating");
  const review = taskCount("review");
  const done = taskCount("done");
  const pendingUpgrades = Number(pendingUpgradeRow?.count ?? 0);
  const mood = chooseMood({
    runtimeBindingCount: bindings.length,
    pendingUpgrades,
    netIncome: pnl.netIncome,
    inProgress,
  });

  return {
    guildId,
    generatedAt,
    scene: {
      key: "local_ai_office",
      title: "Guild AI Local Office",
      mood,
      palette: {
        background: "#0f172a",
        accent: mood === "profitable" ? "#10b981" : mood === "needs_decision" ? "#f59e0b" : "#38bdf8",
        warning: "#f43f5e",
      },
    },
    actors: bindings.map((binding) => ({
      guildAgentId: binding.guild_agent_id,
      roleKey: binding.guild_role_key,
      displayName: binding.guild_display_name,
      runtimeAgentId: binding.runtime_agent_id,
      runtimeName: binding.runtime_agent_name,
      providerName: binding.api_provider_name,
      model: binding.model,
      status: binding.status,
      visualState: binding.status === "disabled" ? "offline" : "ready",
    })),
    accounting: {
      revenue: pnl.revenue,
      expenses: pnl.expenses,
      netIncome: pnl.netIncome,
      visualState: pnl.netIncome > 0 ? "profit" : pnl.netIncome < 0 ? "loss" : "neutral",
    },
    governance: {
      pendingUpgrades,
      latestAdvice: adviceRow?.title ?? null,
      visualState: pendingUpgrades > 0 ? "decision_needed" : "clear",
    },
    tasks: {
      planned,
      inProgress,
      review,
      done,
      visualState: review > 0 ? "reviewing" : inProgress > 0 || planned > 0 ? "active" : "quiet",
    },
  };
}
