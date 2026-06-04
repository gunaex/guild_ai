#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const baseRef = process.env.GUILD_AI_UPSTREAM_BASE ?? "upstream/main";
const headRef = process.env.GUILD_AI_UPSTREAM_HEAD ?? "HEAD";

const riskRules = [
  {
    level: "critical",
    reason: "Server bootstrap/schema changes can break Guild AI SQLite tables or route registration.",
    prefixes: ["server/server-main.ts", "server/modules/bootstrap/schema/", "server/modules/routes.ts"],
  },
  {
    level: "critical",
    reason: "Workflow execution changes can break Guild runtime binding, smoke routing, QA gates, or token usage capture.",
    prefixes: ["server/modules/workflow/", "server/modules/routes/core/tasks/"],
  },
  {
    level: "high",
    reason: "Provider/settings changes can break Ollama/API provider usage parsing and model-limit handling.",
    prefixes: ["server/modules/routes/ops/api-providers", "server/modules/workflow/agents/providers/", "src/components/settings/"],
  },
  {
    level: "high",
    reason: "Task, report, or message route changes can affect audit replay and Guild task lifecycle evidence.",
    prefixes: ["server/modules/routes/ops/messages", "server/modules/routes/ops/task-reports", "server/modules/routes/collab/"],
  },
  {
    level: "medium",
    reason: "UI shell or API client changes can affect the Guild AI panel or typed client.",
    prefixes: ["src/app/", "src/api", "src/components/"],
  },
  {
    level: "medium",
    reason: "Package/build changes can affect local install, tests, or runtime startup.",
    prefixes: ["package.json", "package-lock.json", "pnpm-lock.yaml", "vite.config", "tsconfig"],
  },
];

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    if (err && typeof err === "object" && "stdout" in err && typeof err.stdout === "string" && err.stdout.length > 0) {
      return err.stdout.trim();
    }
    throw err;
  }
}

function classify(path) {
  if (
    path.startsWith("server/modules/guild-ai/") ||
    path === "server/modules/routes/guild-ai.ts" ||
    path.startsWith("src/components/guild-ai/") ||
    path === "src/api/guild-ai.ts" ||
    path.startsWith("templates/guild-ai/") ||
    path.startsWith("scripts/qa/guild-ai-") ||
    path.startsWith("docs/guild-ai/")
  ) {
    return { level: "guild", reason: "Guild AI-owned file changed locally; preserve our behavior." };
  }
  for (const rule of riskRules) {
    if (rule.prefixes.some((prefix) => path === prefix || path.startsWith(prefix))) return rule;
  }
  return { level: "low", reason: "No direct Guild AI integration risk mapped." };
}

function main() {
  let files = [];
  let comparison = `${baseRef}...${headRef}`;
  try {
    files = git(["diff", "--name-only", comparison]).split("\n").filter(Boolean);
  } catch (err) {
    comparison = `${baseRef}..${headRef}`;
    try {
      files = git(["diff", "--name-only", comparison]).split("\n").filter(Boolean);
    } catch (fallbackErr) {
      console.error(`Unable to diff ${baseRef} against ${headRef}.`);
      console.error("Run `git fetch upstream` first, or set GUILD_AI_UPSTREAM_BASE to an existing ref.");
      console.error(fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr));
      process.exit(1);
    }
  }

  const grouped = new Map();
  for (const file of files) {
    const rule = classify(file);
    const list = grouped.get(rule.level) ?? [];
    list.push({ file, reason: rule.reason });
    grouped.set(rule.level, list);
  }

  const order = ["critical", "high", "medium", "guild", "low"];
  console.log(`Guild AI upstream impact: ${comparison}`);
  console.log(`Changed files: ${files.length}`);
  for (const level of order) {
    const items = grouped.get(level) ?? [];
    if (items.length === 0) continue;
    console.log("");
    console.log(`${level.toUpperCase()} (${items.length})`);
    for (const item of items.slice(0, 80)) {
      console.log(`- ${item.file}`);
      console.log(`  ${item.reason}`);
    }
    if (items.length > 80) console.log(`- ... ${items.length - 80} more`);
  }

  const critical = (grouped.get("critical") ?? []).length;
  const high = (grouped.get("high") ?? []).length;
  console.log("");
  if (critical > 0 || high > 0) {
    console.log(`Verdict: REVIEW REQUIRED (${critical} critical, ${high} high).`);
    process.exitCode = 2;
  } else {
    console.log("Verdict: LOW/MEDIUM risk only. Still run the full Guild AI verification suite after merge.");
  }
}

main();
