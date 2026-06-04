#!/usr/bin/env node

const baseUrl = process.env.GUILD_AI_BASE_URL ?? "http://127.0.0.1:8790";
const guildId = process.env.GUILD_AI_GUILD_ID ?? "ecom-001";
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, options);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = { ok: false, error: await res.text().catch(() => "") };
  }
  if (!res.ok || body?.ok === false) {
    const message = body?.error || body?.message || `${res.status} ${res.statusText}`;
    throw new Error(`${path}: ${message}`);
  }
  return { res, body };
}

async function optionalJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { ok: false, detail: `${res.status} ${res.statusText}` };
    return { ok: true, body: await res.json() };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function session() {
  const { res, body } = await request("/api/auth/session");
  return {
    csrf: body.csrf_token,
    cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}

function line(status, label, detail) {
  const tag = status === "pass" ? "PASS" : status === "watch" ? "WATCH" : "FAIL";
  console.log(`${tag} ${label}${detail ? ` - ${detail}` : ""}`);
}

function summarizeGate(gate) {
  if (gate.status === "ready") return "pass";
  if (gate.status === "watch") return "watch";
  return "fail";
}

async function main() {
  const checks = [];
  const add = (status, label, detail = "") => {
    checks.push({ status, label, detail });
    line(status, label, detail);
  };

  let auth;
  try {
    auth = await session();
    add("pass", "server session", baseUrl);
  } catch (err) {
    add("fail", "server session", err instanceof Error ? err.message : String(err));
    console.log("");
    console.log("Guild AI doctor: FAIL (server is not reachable)");
    process.exit(1);
  }

  const headers = { cookie: auth.cookie };
  const health = (await request("/api/guild-ai/health", { headers })).body;
  add("pass", "guild health", `${health.templates} template(s), vector=${health.vectorDbProvider}`);

  const launch = (await request(`/api/guild-ai/launch/${encodeURIComponent(guildId)}/readiness`, { headers })).body.readiness;
  add(
    launch.status === "blocked" ? "fail" : launch.status === "needs_attention" ? "watch" : "pass",
    "final launch readiness",
    `${launch.status}, score=${launch.score}, full=${launch.fullVisionPercent}%, mvp=${launch.localMvpPercent}%`,
  );
  for (const gate of launch.gates ?? []) {
    add(summarizeGate(gate), `gate:${gate.key}`, `${gate.label}: ${gate.detail}`);
  }

  const briefing = (await request(`/api/guild-ai/briefing/${encodeURIComponent(guildId)}`, { headers })).body.briefing;
  add(briefing?.status === "ready" ? "pass" : "watch", "sgm briefing", briefing?.headline ?? "missing");

  const limits = (await request(`/api/guild-ai/limits/${encodeURIComponent(guildId)}`, { headers })).body.events ?? [];
  const activeLimits = limits.filter((event) => event.activeUntil && event.activeUntil > Date.now());
  add(activeLimits.length === 0 ? "pass" : "watch", "active model limits", `${activeLimits.length} active limit(s)`);

  const pmReport = (await request(`/api/guild-ai/reports/${encodeURIComponent(guildId)}/daily/latest`, { headers })).body.report;
  add(pmReport ? "pass" : "watch", "daily PM report", pmReport ? `latest ${pmReport.report_date}` : "no report generated yet");

  const ollama = await optionalJson(`${ollamaBaseUrl.replace(/\/$/, "")}/v1/models`);
  add(ollama.ok ? "pass" : "watch", "local Ollama", ollama.ok ? `${ollama.body?.data?.length ?? 0} model(s)` : ollama.detail);

  const failed = checks.filter((check) => check.status === "fail");
  const watched = checks.filter((check) => check.status === "watch");
  console.log("");
  console.log(
    `Guild AI doctor: ${failed.length === 0 ? "PASS" : "FAIL"} (${checks.length - failed.length}/${checks.length}, watch=${watched.length})`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`Guild AI doctor failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
