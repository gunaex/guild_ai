import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildBackupSnapshot = {
  id: string;
  guild_id: string;
  backup_dir: string;
  retention_days: number;
  status: "succeeded" | "failed";
  manifest_json: string;
  error: string | null;
  created_at: number;
};

export type GuildBackupRunResult = {
  snapshot: GuildBackupSnapshot;
  manifest: {
    id: string;
    guildId: string;
    createdAt: number;
    retentionDays: number;
    backupDir: string;
    files: Array<{ key: string; source: string; target: string; sizeBytes: number }>;
    pruned: string[];
  };
};

function readSetting(db: DbLike, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value?: string } | undefined;
  return row?.value;
}

function readBooleanSetting(db: DbLike, key: string, fallback: boolean): boolean {
  const value = readSetting(db, key);
  if (value === undefined) return fallback;
  return value === "true" || value === "\"true\"" || value === "1";
}

export function readGuildBackupRetentionDays(db: DbLike): number {
  const value = Number(String(readSetting(db, "guildAiBackupRetentionDays") ?? "14").replace(/"/g, ""));
  if (!Number.isInteger(value) || value < 1) return 14;
  return Math.min(value, 365);
}

export function isGuildAutomaticBackupEnabled(db: DbLike): boolean {
  if (process.env.GUILD_AI_BACKUP_SCHEDULER === "0") return false;
  return readBooleanSetting(db, "guildAiBackupEnabled", true);
}

export function resolveGuildBackupDir(dbPath: string): string {
  return process.env.GUILD_AI_BACKUP_DIR?.trim() || path.join(path.dirname(dbPath), "guild-ai-backups");
}

function copyIfExists(source: string, targetDir: string, key: string): { key: string; source: string; target: string; sizeBytes: number } | null {
  if (!fs.existsSync(source)) return null;
  const stat = fs.statSync(source);
  if (!stat.isFile()) return null;
  const target = path.join(targetDir, `${key}${path.extname(source) || ".bin"}`);
  fs.copyFileSync(source, target);
  return { key, source, target, sizeBytes: stat.size };
}

function pruneOldSnapshots(backupDir: string, now: number, retentionDays: number): string[] {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  if (!fs.existsSync(backupDir)) return [];
  const pruned: string[] = [];
  for (const entry of fs.readdirSync(backupDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("snapshot-")) continue;
    const fullPath = path.join(backupDir, entry.name);
    const stat = fs.statSync(fullPath);
    if (stat.mtimeMs >= cutoff) continue;
    fs.rmSync(fullPath, { recursive: true, force: true });
    pruned.push(fullPath);
  }
  return pruned;
}

export function runGuildBackupSnapshot(input: {
  db: DatabaseSync;
  guildId: string;
  dbPath: string;
  logsDir: string;
  now: number;
  backupDir?: string | null;
  retentionDays?: number;
}): GuildBackupRunResult {
  const id = randomUUID();
  const retentionDays = input.retentionDays ?? readGuildBackupRetentionDays(input.db);
  const backupRoot = input.backupDir?.trim() || resolveGuildBackupDir(input.dbPath);
  const snapshotDir = path.join(backupRoot, `snapshot-${new Date(input.now).toISOString().replace(/[:.]/g, "-")}-${input.guildId}`);
  const manifestPath = path.join(snapshotDir, "manifest.json");
  let manifest: GuildBackupRunResult["manifest"] = {
    id,
    guildId: input.guildId,
    createdAt: input.now,
    retentionDays,
    backupDir: snapshotDir,
    files: [],
    pruned: [],
  };

  try {
    fs.mkdirSync(snapshotDir, { recursive: true });
    const files = [
      copyIfExists(input.dbPath, snapshotDir, "sqlite-db"),
      copyIfExists(`${input.dbPath}-wal`, snapshotDir, "sqlite-wal"),
      copyIfExists(`${input.dbPath}-shm`, snapshotDir, "sqlite-shm"),
      copyIfExists(path.join(input.logsDir, "security-audit.ndjson"), snapshotDir, "security-audit"),
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));
    manifest = { ...manifest, files, pruned: pruneOldSnapshots(backupRoot, input.now, retentionDays) };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    input.db
      .prepare(
        `INSERT INTO guild_backup_snapshots (
          id, guild_id, backup_dir, retention_days, status, manifest_json, error, created_at
        ) VALUES (?, ?, ?, ?, 'succeeded', ?, NULL, ?)`,
      )
      .run(id, input.guildId, snapshotDir, retentionDays, JSON.stringify(manifest), input.now);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    input.db
      .prepare(
        `INSERT INTO guild_backup_snapshots (
          id, guild_id, backup_dir, retention_days, status, manifest_json, error, created_at
        ) VALUES (?, ?, ?, ?, 'failed', ?, ?, ?)`,
      )
      .run(id, input.guildId, snapshotDir, retentionDays, JSON.stringify(manifest), error, input.now);
  }

  const snapshot = input.db.prepare("SELECT * FROM guild_backup_snapshots WHERE id = ?").get(id) as GuildBackupSnapshot;
  return { snapshot, manifest };
}

export function listGuildBackupSnapshots(db: DbLike, guildId: string, limit = 10): GuildBackupSnapshot[] {
  return db
    .prepare(
      `SELECT *
       FROM guild_backup_snapshots
       WHERE guild_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(guildId, Math.max(1, Math.min(50, Math.floor(limit)))) as GuildBackupSnapshot[];
}

export function runGuildBackupForAllGuilds(input: {
  db: DatabaseSync;
  dbPath: string;
  logsDir: string;
  now: number;
}): number {
  const guilds = input.db.prepare("SELECT guild_id AS guildId FROM guild_templates ORDER BY guild_id ASC").all() as Array<{
    guildId: string;
  }>;
  let count = 0;
  for (const { guildId } of guilds) {
    runGuildBackupSnapshot({ db: input.db, guildId, dbPath: input.dbPath, logsDir: input.logsDir, now: input.now });
    count += 1;
  }
  return count;
}

export function startGuildBackupScheduler(input: {
  db: DatabaseSync;
  dbPath: string;
  logsDir: string;
  nowMs: () => number;
}): { stop: () => void } {
  if (!isGuildAutomaticBackupEnabled(input.db)) return { stop: () => undefined };

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const run = () => {
    if (stopped) return;
    try {
      const count = runGuildBackupForAllGuilds({
        db: input.db,
        dbPath: input.dbPath,
        logsDir: input.logsDir,
        now: input.nowMs(),
      });
      if (count > 0) console.log(`[Guild AI] Automatic backup completed for ${count} guild(s).`);
    } catch (err) {
      console.error("[Guild AI] Automatic backup failed:", err instanceof Error ? err.message : err);
    } finally {
      scheduleNext();
    }
  };

  const scheduleNext = () => {
    if (stopped) return;
    timer = setTimeout(run, 24 * 60 * 60 * 1000);
    timer.unref?.();
    console.log("[Guild AI] Automatic backup scheduler armed for 24 hour(s).");
  };

  timer = setTimeout(run, 10_000);
  timer.unref?.();
  console.log("[Guild AI] Automatic backup scheduler armed for startup run.");
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
