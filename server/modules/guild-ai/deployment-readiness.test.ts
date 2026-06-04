import { describe, expect, it } from "vitest";
import { buildGuildDeploymentReadiness } from "./deployment-readiness.ts";

describe("Guild AI deployment readiness", () => {
  it("keeps loopback development in local mode", () => {
    const readiness = buildGuildDeploymentReadiness({
      guildId: "ecom-001",
      generatedAt: Date.UTC(2026, 0, 2),
      host: "127.0.0.1",
      port: 8790,
      logsDir: "/tmp",
      viteDev: true,
    });

    expect(readiness.mode).toBe("local");
    expect(readiness.readyForLan).toBe(false);
    expect(readiness.gates.find((gate) => gate.key === "auth")?.status).toBe("watch");
  });

  it("requires strong auth and scoped origins for LAN readiness", () => {
    const readiness = buildGuildDeploymentReadiness({
      guildId: "ecom-001",
      generatedAt: Date.UTC(2026, 0, 2),
      host: "0.0.0.0",
      port: 8790,
      apiAuthToken: "abcdefghijklmnopqrstuvwxyz123456",
      allowedOrigins: ["http://guild-ai.local:8790"],
      logsDir: "/tmp",
      viteDev: false,
    });

    expect(readiness.mode).toBe("lan");
    expect(readiness.readyForLan).toBe(true);
    expect(readiness.readyForInternet).toBe(false);
    expect(readiness.gates.find((gate) => gate.key === "auth")?.status).toBe("ready");
  });
});
