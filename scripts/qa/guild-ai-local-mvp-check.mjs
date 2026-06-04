#!/usr/bin/env node

const baseUrl = process.env.GUILD_AI_BASE_URL ?? "http://127.0.0.1:8790";
const guildId = process.env.GUILD_AI_GUILD_ID ?? "ecom-001";

const requiredRoles = new Set(["pm", "techLead", "worker", "qa", "hr", "accounting"]);

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

async function session() {
  const { res, body } = await request("/api/auth/session");
  return {
    csrf: body.csrf_token,
    cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}

function artifactCompleted(snapshot) {
  const artifact = snapshot.artifacts?.find((item) => item.name === "SMOKE_RESULT.md");
  return Boolean(
    artifact?.exists &&
      artifact.content?.trim() &&
      !artifact.content.includes("Pending agent execution.") &&
      /Status:\s*completed|RUN completed|Provider Output/i.test(artifact.content),
  );
}

function pass(label, detail) {
  console.log(`PASS ${label}${detail ? ` - ${detail}` : ""}`);
}

function fail(label, detail) {
  console.log(`FAIL ${label}${detail ? ` - ${detail}` : ""}`);
}

async function main() {
  const gates = [];
  const addGate = (label, ok, detail) => {
    gates.push({ label, ok, detail });
    if (ok) pass(label, detail);
    else fail(label, detail);
  };

  const auth = await session();
  const cookieHeaders = { cookie: auth.cookie };

  const health = (await request("/api/guild-ai/health", { headers: cookieHeaders })).body;
  addGate("health", health.ok === true, `${health.templates} template(s), vector=${health.vectorDbProvider}`);

  const templates = (await request("/api/guild-ai/templates", { headers: cookieHeaders })).body.templates ?? [];
  addGate("default template", templates.some((template) => template.guild_id === guildId), guildId);

  const accounts = (await request(`/api/guild-ai/accounting/${encodeURIComponent(guildId)}/accounts`, { headers: cookieHeaders })).body;
  const categories = new Set((accounts.categories ?? []).map((category) => category.key));
  addGate(
    "thai accounting categories",
    ["asset", "liability", "equity", "revenue", "expense"].every((key) => categories.has(key)),
    `${accounts.accounts?.length ?? 0} account(s)`,
  );

  const accounting = (await request(`/api/guild-ai/accounting/${encodeURIComponent(guildId)}`, { headers: cookieHeaders })).body;
  addGate(
    "accounting operating data",
    Number(accounting.summary?.totalTokens ?? 0) >= 0 && Number.isFinite(Number(accounting.profitAndLoss?.netIncome ?? 0)),
    `${accounting.summary?.totalTokens ?? 0} token(s), net=${accounting.profitAndLoss?.netIncome ?? 0}`,
  );

  const bindings = (await request(`/api/guild-ai/runtime/${encodeURIComponent(guildId)}/bindings`, { headers: cookieHeaders })).body
    .bindings ?? [];
  const availableRoles = new Set(
    bindings
      .filter((binding) => binding.status === "active" && binding.availability_status === "available")
      .map((binding) => binding.guild_role_key),
  );
  const missingRoles = [...requiredRoles].filter((role) => !availableRoles.has(role));
  addGate("runtime bindings", missingRoles.length === 0, missingRoles.length ? `missing: ${missingRoles.join(", ")}` : `${bindings.length} binding(s)`);

  const smokeList = (await request(`/api/guild-ai/runtime/${encodeURIComponent(guildId)}/task-smokes?limit=1`, { headers: cookieHeaders }))
    .body.tasks ?? [];
  const latestSmoke = smokeList[0];
  addGate("latest smoke task", Boolean(latestSmoke), latestSmoke ? `${latestSmoke.taskId} / ${latestSmoke.status}` : "none");

  if (latestSmoke) {
    const logs = (await request(`/api/guild-ai/tasks/${encodeURIComponent(latestSmoke.taskId)}/logs`, { headers: cookieHeaders })).body;
    const artifacts = (
      await request(`/api/guild-ai/tasks/${encodeURIComponent(latestSmoke.taskId)}/artifacts?guildId=${encodeURIComponent(guildId)}`, {
        headers: cookieHeaders,
      })
    ).body;
    addGate("smoke completed or in QA", ["done", "review"].includes(logs.task?.status), logs.task?.status ?? "unknown");
    addGate("smoke artifact evidence", artifactCompleted(artifacts), "SMOKE_RESULT.md");
  }

  const briefing = (await request(`/api/guild-ai/briefing/${encodeURIComponent(guildId)}`, { headers: cookieHeaders })).body.briefing;
  addGate("sgm briefing", Boolean(briefing?.headline && briefing?.readiness?.length), briefing?.headline ?? "missing");

  const limits = (await request(`/api/guild-ai/limits/${encodeURIComponent(guildId)}`, { headers: cookieHeaders })).body.events ?? [];
  const activeLimits = limits.filter((event) => event.activeUntil && event.activeUntil > Date.now());
  addGate("active model limits do not block MVP", activeLimits.length === 0, `${activeLimits.length} active limit(s)`);

  const failed = gates.filter((gate) => !gate.ok);
  console.log("");
  console.log(`Guild AI local MVP check: ${failed.length === 0 ? "PASS" : "FAIL"} (${gates.length - failed.length}/${gates.length})`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Guild AI local MVP check failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
