import fs from "node:fs";
import path from "node:path";

export type GuildDeploymentGate = {
  key: "binding" | "auth" | "origin" | "csrf" | "audit" | "dev_server" | "internet";
  label: string;
  status: "ready" | "watch" | "blocked";
  detail: string;
};

export type GuildDeploymentReadiness = {
  guildId: string;
  generatedAt: number;
  mode: "local" | "lan" | "internet";
  host: string;
  port: number;
  localOnly: boolean;
  readyForLan: boolean;
  readyForInternet: boolean;
  gates: GuildDeploymentGate[];
  nextActions: string[];
};

function hasStrongToken(value: string | undefined): boolean {
  const token = (value ?? "").trim();
  return token.length >= 24 && token !== "__CHANGE_ME__";
}

export function buildGuildDeploymentReadiness(input: {
  guildId: string;
  generatedAt: number;
  host: string;
  port: number;
  apiAuthToken?: string;
  allowedOrigins?: string[];
  allowedOriginSuffixes?: string[];
  logsDir: string;
  viteDev?: boolean;
  internetProxyEnabled?: boolean;
}): GuildDeploymentReadiness {
  const localOnly = input.host === "127.0.0.1" || input.host === "localhost" || input.host === "::1";
  const lanBound = input.host === "0.0.0.0" || input.host === "::";
  const strongToken = hasStrongToken(input.apiAuthToken);
  const allowedOrigins = input.allowedOrigins ?? [];
  const allowedOriginSuffixes = input.allowedOriginSuffixes ?? [];
  const auditLogPath = path.join(input.logsDir, "security-audit.ndjson");
  const auditReady = fs.existsSync(input.logsDir) && (fs.existsSync(auditLogPath) || fs.existsSync(path.dirname(auditLogPath)));
  const originScoped = allowedOrigins.length > 0 || allowedOriginSuffixes.length > 0;
  const internetProxyEnabled = Boolean(input.internetProxyEnabled);

  const gates: GuildDeploymentGate[] = [
    {
      key: "binding",
      label: "Network binding",
      status: localOnly ? "watch" : lanBound ? "ready" : "watch",
      detail: localOnly
        ? "Server is bound to loopback only; safe for local use, not reachable from LAN."
        : lanBound
          ? "Server is reachable on LAN interfaces."
          : `Server is bound to ${input.host}.`,
    },
    {
      key: "auth",
      label: "Auth token",
      status: strongToken ? "ready" : localOnly ? "watch" : "blocked",
      detail: strongToken
        ? "API_AUTH_TOKEN is explicitly configured."
        : "API_AUTH_TOKEN is missing or weak; non-local access must set a strong token.",
    },
    {
      key: "origin",
      label: "Allowed origins",
      status: originScoped ? "ready" : localOnly ? "watch" : "blocked",
      detail: originScoped
        ? `Allowed origins/suffixes configured (${allowedOrigins.length + allowedOriginSuffixes.length}).`
        : "Set ALLOWED_ORIGINS or ALLOWED_ORIGIN_SUFFIXES before LAN/internet access.",
    },
    {
      key: "csrf",
      label: "CSRF/session guard",
      status: "ready",
      detail: "Session cookies use SameSite=Strict and non-bearer writes require CSRF.",
    },
    {
      key: "audit",
      label: "Security audit log",
      status: auditReady ? "ready" : "watch",
      detail: auditReady ? `Audit log directory is available at ${input.logsDir}.` : "Audit log directory is not available yet.",
    },
    {
      key: "dev_server",
      label: "Dev server exposure",
      status: input.viteDev && !localOnly ? "blocked" : input.viteDev ? "watch" : "ready",
      detail: input.viteDev
        ? "Running in VITE_DEV mode; keep this local or behind trusted private networking only."
        : "Production static serving mode is preferred for long-running service.",
    },
    {
      key: "internet",
      label: "Internet exposure",
      status: internetProxyEnabled ? "watch" : "blocked",
      detail: internetProxyEnabled
        ? "HTTPS reverse proxy flag is set; still verify firewall, backups, and auth."
        : "Raw Node/Vite servers must not be exposed directly to the internet.",
    },
  ];

  const readyForLan = !localOnly && strongToken && originScoped && !gates.some((gate) => gate.key === "dev_server" && gate.status === "blocked");
  const readyForInternet = readyForLan && internetProxyEnabled && !input.viteDev;
  const mode = readyForInternet ? "internet" : readyForLan ? "lan" : "local";
  const nextActions = gates
    .filter((gate) => gate.status !== "ready")
    .map((gate) => gate.detail)
    .slice(0, 5);
  if (nextActions.length === 0) nextActions.push("Keep backups and audit log verification in the operating routine.");

  return {
    guildId: input.guildId,
    generatedAt: input.generatedAt,
    mode,
    host: input.host,
    port: input.port,
    localOnly,
    readyForLan,
    readyForInternet,
    gates,
    nextActions,
  };
}
