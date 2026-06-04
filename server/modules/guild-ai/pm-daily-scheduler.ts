import type { DatabaseSync } from "node:sqlite";
import {
  ALLOWED_ORIGINS,
  ALLOWED_ORIGIN_SUFFIXES,
  API_AUTH_TOKEN,
  HOST,
  PORT,
} from "../../config/runtime.ts";
import { buildGuildBackupReadiness } from "./backup-readiness.ts";
import { buildGuildDeploymentReadiness } from "./deployment-readiness.ts";
import { buildGuildLaunchReadiness } from "./launch-readiness.ts";
import { generateGuildPmDailyReport, msUntilNextDailyPmReport } from "./pm-daily-report.ts";

export function generateDailyPmReportsForAllGuilds(input: {
  db: DatabaseSync;
  generatedAt: number;
  dbPath: string;
  logsDir: string;
}): number {
  const guilds = input.db.prepare("SELECT guild_id AS guildId FROM guild_templates ORDER BY guild_id ASC").all() as Array<{
    guildId: string;
  }>;
  let count = 0;
  for (const { guildId } of guilds) {
    const deployment = buildGuildDeploymentReadiness({
      guildId,
      generatedAt: input.generatedAt,
      host: HOST,
      port: PORT,
      apiAuthToken: API_AUTH_TOKEN,
      allowedOrigins: ALLOWED_ORIGINS,
      allowedOriginSuffixes: ALLOWED_ORIGIN_SUFFIXES,
      logsDir: input.logsDir,
      viteDev: Boolean(process.env.VITE_DEV),
      internetProxyEnabled: process.env.GUILD_AI_HTTPS_PROXY === "1",
    });
    const backup = buildGuildBackupReadiness({
      guildId,
      generatedAt: input.generatedAt,
      dbPath: input.dbPath,
      logsDir: input.logsDir,
      backupDir: process.env.GUILD_AI_BACKUP_DIR ?? null,
    });
    const launch = buildGuildLaunchReadiness({ db: input.db, guildId, generatedAt: input.generatedAt, deployment, backup });
    generateGuildPmDailyReport({
      db: input.db,
      guildId,
      generatedAt: input.generatedAt,
      launch,
      source: "scheduler",
    });
    count += 1;
  }
  return count;
}

export function startGuildPmDailyReportScheduler(input: {
  db: DatabaseSync;
  dbPath: string;
  logsDir: string;
  nowMs: () => number;
}): { stop: () => void } {
  if (process.env.GUILD_AI_PM_REPORT_SCHEDULER === "0") {
    return { stop: () => undefined };
  }

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const run = () => {
    if (stopped) return;
    try {
      const count = generateDailyPmReportsForAllGuilds({
        db: input.db,
        dbPath: input.dbPath,
        logsDir: input.logsDir,
        generatedAt: input.nowMs(),
      });
      if (count > 0) console.log(`[Guild AI] Daily PM report generated for ${count} guild(s).`);
    } catch (err) {
      console.error("[Guild AI] Daily PM report scheduler failed:", err instanceof Error ? err.message : err);
    } finally {
      scheduleNext();
    }
  };

  const scheduleNext = () => {
    if (stopped) return;
    const delay = msUntilNextDailyPmReport(input.nowMs());
    timer = setTimeout(run, delay);
    timer.unref?.();
    console.log(`[Guild AI] Daily PM report scheduler armed for ${Math.round(delay / 60_000)} minute(s).`);
  };

  scheduleNext();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
