import type { DatabaseSync } from "node:sqlite";
import { getActiveAiLimit } from "./limit-events.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

type ApiProviderRow = {
  id: string;
  name: string;
  type: string;
  models_cache: string | null;
};

type GuildRoleRow = {
  guild_id: string;
  agent_id: string;
  role_key: string;
  display_name: string;
};

type RuntimeAgentRow = {
  id: string;
  name: string;
  role: string;
  department_id: string | null;
};

export type GuildRuntimeBinding = {
  guild_id: string;
  guild_agent_id: string;
  guild_role_key: string;
  guild_display_name: string;
  runtime_agent_id: string;
  runtime_agent_name: string;
  api_provider_id: string;
  api_provider_name: string;
  model: string;
  status: "active" | "disabled";
  availability_status?: "available" | "limited" | "disabled";
  active_limit?: {
    id: number;
    limitType: string;
    message: string;
    activeUntil: number | null;
  } | null;
  updated_at: number;
};

export function selectGuildRuntimeBindingForRole(
  db: DbLike,
  guildId: string,
  roleKey: string,
): GuildRuntimeBinding | null {
  const matches = listGuildRuntimeBindings(db, guildId).filter(
    (binding) => binding.status === "active" && binding.guild_role_key === roleKey,
  );
  return matches.find((binding) => binding.availability_status === "available") ?? matches[0] ?? null;
}

function parseModelCache(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function chooseOllamaModel(models: string[], requestedModel?: string | null): string {
  const requested = requestedModel?.trim();
  if (requested && models.includes(requested)) return requested;

  const runnable = models.filter((model) => !/embed/i.test(model));
  const priorities = ["typhoon", "llama3", "gemma", "hermes", "mistral"];
  for (const priority of priorities) {
    const match = runnable.find((model) => model.toLowerCase().includes(priority));
    if (match) return match;
  }
  return runnable[0] ?? models[0] ?? "";
}

function findAgent(candidates: RuntimeAgentRow[], used: Set<string>, departmentId: string, roles: string[]): RuntimeAgentRow | null {
  for (const role of roles) {
    const match = candidates.find(
      (agent) => !used.has(agent.id) && agent.department_id === departmentId && agent.role === role,
    );
    if (match) {
      used.add(match.id);
      return match;
    }
  }
  return null;
}

export function bootstrapGuildRuntimeWithOllama(
  db: DbLike,
  input: { guildId: string; model?: string | null; assignRuntimeAgents?: boolean; now: number },
): { provider: ApiProviderRow; model: string; bindings: GuildRuntimeBinding[] } {
  const provider = db
    .prepare("SELECT id, name, type, models_cache FROM api_providers WHERE type = 'ollama' AND enabled = 1 ORDER BY updated_at DESC LIMIT 1")
    .get() as ApiProviderRow | undefined;
  if (!provider) throw new Error("Local Ollama provider is not configured.");

  const model = chooseOllamaModel(parseModelCache(provider.models_cache), input.model);
  if (!model) throw new Error("Local Ollama provider has no runnable models.");

  const roles = db
    .prepare(
      `SELECT guild_id, agent_id, role_key, display_name
       FROM guild_agent_roles
       WHERE guild_id = ?
       ORDER BY
         CASE role_key
           WHEN 'pm' THEN 1
           WHEN 'techLead' THEN 2
           WHEN 'worker' THEN 3
           WHEN 'qa' THEN 4
           WHEN 'hr' THEN 5
           WHEN 'accounting' THEN 6
           ELSE 99
         END`,
    )
    .all(input.guildId) as GuildRoleRow[];
  if (roles.length === 0) throw new Error("Guild has no agent roles to bind.");

  const runtimeAgents = db
    .prepare(
      `SELECT id, name, role, department_id
       FROM agents
       WHERE status != 'offline'
       ORDER BY created_at ASC`,
    )
    .all() as RuntimeAgentRow[];

  const used = new Set<string>();
  const picks = new Map<string, RuntimeAgentRow>();
  for (const role of roles) {
    const pick =
      role.role_key === "pm"
        ? findAgent(runtimeAgents, used, "planning", ["team_leader", "senior"])
        : role.role_key === "techLead"
          ? findAgent(runtimeAgents, used, "dev", ["team_leader"])
          : role.role_key === "worker"
            ? findAgent(runtimeAgents, used, "dev", ["senior", "junior"])
            : role.role_key === "qa"
              ? findAgent(runtimeAgents, used, "qa", ["team_leader", "senior", "junior"])
              : role.role_key === "accounting"
                ? findAgent(runtimeAgents, used, "operations", ["team_leader", "senior"])
                : findAgent(runtimeAgents, used, "operations", ["senior", "team_leader"]);
    if (pick) picks.set(role.agent_id, pick);
  }

  const insert = db.prepare(
    `INSERT INTO guild_runtime_bindings (
      guild_id, guild_agent_id, runtime_agent_id, api_provider_id, model, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    ON CONFLICT(guild_id, guild_agent_id) DO UPDATE SET
      runtime_agent_id = excluded.runtime_agent_id,
      api_provider_id = excluded.api_provider_id,
      model = excluded.model,
      status = 'active',
      updated_at = excluded.updated_at`,
  );
  const updateAgent = db.prepare(
    "UPDATE agents SET cli_provider = 'api', api_provider_id = ?, api_model = ? WHERE id = ?",
  );

  for (const role of roles) {
    const runtimeAgent = picks.get(role.agent_id);
    if (!runtimeAgent) continue;
    insert.run(input.guildId, role.agent_id, runtimeAgent.id, provider.id, model, input.now, input.now);
    if (input.assignRuntimeAgents !== false) {
      updateAgent.run(provider.id, model, runtimeAgent.id);
    }
  }

  return { provider, model, bindings: listGuildRuntimeBindings(db, input.guildId) };
}

export function listGuildRuntimeBindings(db: DbLike, guildId: string): GuildRuntimeBinding[] {
  const bindings = db
    .prepare(
      `SELECT
         b.guild_id,
         b.guild_agent_id,
         r.role_key AS guild_role_key,
         r.display_name AS guild_display_name,
         b.runtime_agent_id,
         a.name AS runtime_agent_name,
         b.api_provider_id,
         p.name AS api_provider_name,
         b.model,
         b.status,
         b.updated_at
       FROM guild_runtime_bindings b
       JOIN guild_agent_roles r
         ON r.guild_id = b.guild_id AND r.agent_id = b.guild_agent_id
       JOIN agents a
         ON a.id = b.runtime_agent_id
       JOIN api_providers p
         ON p.id = b.api_provider_id
       WHERE b.guild_id = ?
       ORDER BY
         CASE r.role_key
           WHEN 'pm' THEN 1
           WHEN 'techLead' THEN 2
           WHEN 'worker' THEN 3
           WHEN 'qa' THEN 4
           WHEN 'hr' THEN 5
           WHEN 'accounting' THEN 6
           ELSE 99
         END`,
    )
    .all(guildId) as GuildRuntimeBinding[];
  return bindings.map((binding) => {
    if (binding.status !== "active") {
      return { ...binding, availability_status: "disabled", active_limit: null };
    }
    const activeLimit = getActiveAiLimit(db as any, {
      apiProviderId: binding.api_provider_id,
      model: binding.model,
    });
    return {
      ...binding,
      availability_status: activeLimit.limited ? "limited" : "available",
      active_limit: activeLimit.event
        ? {
            id: activeLimit.event.id,
            limitType: activeLimit.event.limitType,
            message: activeLimit.event.message,
            activeUntil: activeLimit.event.activeUntil,
          }
        : null,
    };
  });
}
