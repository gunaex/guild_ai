import { describe, expect, it } from "vitest";
import { validateGuildTemplate } from "./templates.ts";

const validTemplate = {
  guildId: "ecom-001",
  name: "Thai Commerce Ops",
  businessType: "e-commerce",
  currency: "THB",
  agents: [
    { id: "pm-001", displayName: "PM", role: "pm", model: "gpt-4o" },
    { id: "tech-001", displayName: "Tech Lead", role: "techLead", model: "gpt-4o", reportsTo: "pm-001" },
    { id: "worker-001", displayName: "Worker", role: "worker", model: "local/gemma", reportsTo: "tech-001" },
    { id: "qa-001", displayName: "QA", role: "qa", model: "local/gemma", reportsTo: "tech-001" },
    { id: "hr-001", displayName: "HR", role: "hr", model: "local/gemma", reportsTo: "pm-001" },
    { id: "acct-001", displayName: "Accounting", role: "accounting", model: "local/gemma", reportsTo: "pm-001" },
  ],
};

describe("Guild AI template validation", () => {
  it("accepts a universal organization template", () => {
    const result = validateGuildTemplate(validTemplate);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.template.guildId).toBe("ecom-001");
    }
  });

  it("requires exactly one core role and at least one worker", () => {
    const invalid = {
      ...validTemplate,
      agents: validTemplate.agents.filter((agent) => agent.role !== "accounting"),
    };

    const result = validateGuildTemplate(invalid);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("accounting");
    }
  });

  it("rejects unknown reporting lines", () => {
    const invalid = {
      ...validTemplate,
      agents: validTemplate.agents.map((agent) =>
        agent.id === "worker-001" ? { ...agent, reportsTo: "missing-agent" } : agent,
      ),
    };

    const result = validateGuildTemplate(invalid);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("missing-agent");
    }
  });
});
