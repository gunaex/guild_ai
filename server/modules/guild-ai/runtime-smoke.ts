export type GuildRuntimeSmokeRole = "pm" | "techLead" | "worker" | "qa" | "hr" | "accounting";

export function normalizeSmokeRole(value: unknown): GuildRuntimeSmokeRole {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw === "pm" || raw === "techLead" || raw === "worker" || raw === "qa" || raw === "hr" || raw === "accounting") {
    return raw;
  }
  return "techLead";
}

export function buildGuildRuntimeSmokePrompt(input: {
  guildId: string;
  roleKey: GuildRuntimeSmokeRole;
  runtimeAgentName: string;
  message?: string | null;
}): string {
  const message = typeof input.message === "string" && input.message.trim()
    ? input.message.trim()
    : "Confirm that this Guild AI runtime binding can answer through the configured local model.";

  return [
    "[Guild AI Runtime Smoke Test]",
    `Guild ID: ${input.guildId}`,
    `Guild role: ${input.roleKey}`,
    `Runtime agent: ${input.runtimeAgentName}`,
    "",
    "You are running a read-only smoke test.",
    "Do not use tools, do not modify files, and do not claim to have executed external actions.",
    "Return one compact JSON object only with these keys:",
    '- "ok": boolean',
    '- "agent": string',
    '- "role": string',
    '- "message": string',
    "",
    `User smoke message: ${message}`,
  ].join("\n");
}

export function stripApiProviderEnvelope(raw: string): string {
  return raw
    .replace(/^\[api:[^\]]*\][^\n]*\n---\n/g, "")
    .replace(/\n---\n\[api:[^\]]*\]\s*Done\.\s*$/g, "")
    .trim();
}
