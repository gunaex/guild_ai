export type RequiredGuildRole = "pm" | "techLead" | "qa" | "hr" | "accounting";
export type GuildRole = RequiredGuildRole | "worker";

export type GuildAgentTemplate = {
  id: string;
  displayName: string;
  role: GuildRole;
  model: string;
  reportsTo?: string;
  schedule?: string;
  tools?: string[];
  budgetUsdDaily?: number;
  productivityFloor?: number;
};

export type GuildTemplateInput = {
  guildId: string;
  name: string;
  businessType: string;
  currency?: "USD" | "THB";
  agents: GuildAgentTemplate[];
};

export const REQUIRED_GUILD_ROLES: RequiredGuildRole[] = ["pm", "techLead", "qa", "hr", "accounting"];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isGuildRole(value: unknown): value is GuildRole {
  return value === "pm" || value === "techLead" || value === "worker" || value === "qa" || value === "hr" || value === "accounting";
}

export function validateGuildTemplate(value: unknown): { ok: true; template: GuildTemplateInput } | { ok: false; error: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Template must be an object." };
  }

  const template = value as GuildTemplateInput;
  if (!isNonEmptyString(template.guildId)) return { ok: false, error: "guildId is required." };
  if (!isNonEmptyString(template.name)) return { ok: false, error: "name is required." };
  if (!isNonEmptyString(template.businessType)) return { ok: false, error: "businessType is required." };
  if (!Array.isArray(template.agents)) return { ok: false, error: "agents must be an array." };

  const ids = new Set<string>();
  for (const agent of template.agents) {
    if (!isNonEmptyString(agent.id)) return { ok: false, error: "Every agent needs an id." };
    if (ids.has(agent.id)) return { ok: false, error: `Duplicate agent id: ${agent.id}` };
    ids.add(agent.id);
    if (!isNonEmptyString(agent.displayName)) return { ok: false, error: `Agent ${agent.id} needs displayName.` };
    if (!isGuildRole(agent.role)) return { ok: false, error: `Agent ${agent.id} has invalid role.` };
    if (!isNonEmptyString(agent.model)) return { ok: false, error: `Agent ${agent.id} needs model.` };
  }

  for (const role of REQUIRED_GUILD_ROLES) {
    const count = template.agents.filter((agent) => agent.role === role).length;
    if (count !== 1) return { ok: false, error: `Template must define exactly one ${role} agent.` };
  }

  if (!template.agents.some((agent) => agent.role === "worker")) {
    return { ok: false, error: "Template must define at least one worker." };
  }

  for (const agent of template.agents) {
    if (agent.reportsTo && !ids.has(agent.reportsTo)) {
      return { ok: false, error: `Agent ${agent.id} reports to unknown agent ${agent.reportsTo}.` };
    }
  }

  return { ok: true, template };
}
