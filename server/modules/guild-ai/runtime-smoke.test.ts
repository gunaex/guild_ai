import { describe, expect, it } from "vitest";
import { buildGuildRuntimeSmokePrompt, normalizeSmokeRole, stripApiProviderEnvelope } from "./runtime-smoke.ts";

describe("Guild AI runtime smoke helpers", () => {
  it("defaults to the tech lead role when smoke role input is invalid", () => {
    expect(normalizeSmokeRole("qa")).toBe("qa");
    expect(normalizeSmokeRole("unknown")).toBe("techLead");
    expect(normalizeSmokeRole(null)).toBe("techLead");
  });

  it("builds a read-only smoke prompt", () => {
    const prompt = buildGuildRuntimeSmokePrompt({
      guildId: "ecom-001",
      roleKey: "techLead",
      runtimeAgentName: "Aria",
      message: "ping",
    });

    expect(prompt).toContain("Guild ID: ecom-001");
    expect(prompt).toContain("Runtime agent: Aria");
    expect(prompt).toContain("Do not use tools, do not modify files");
    expect(prompt).toContain("User smoke message: ping");
  });

  it("strips API provider stream envelope text", () => {
    expect(stripApiProviderEnvelope("[api:ollama] Provider: Local, Model: llama3\n---\n{\"ok\":true}\n---\n[api:ollama] Done.\n")).toBe(
      "{\"ok\":true}",
    );
  });
});
