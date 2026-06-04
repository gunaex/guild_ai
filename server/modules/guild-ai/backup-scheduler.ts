import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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
    restoreProof: {
      status: "verified" | "failed";
      checkedAt: number;
      integrity: string;
      requiredTablesPresent: boolean;
      error?: string;
    } | null;
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

function verifySnapshotRestore(input: {
  snapshotDbPath: string | null;
  checkedAt: number;
}): NonNullable<GuildBackupRunResult["manifest"]["restoreProof"]> {
  if (!input.snapshotDbPath) {
    return {
      status: "failed",
      checkedAt: input.checkedAt,
      integrity: "missing",
      requiredTablesPresent: false,
      error: "Snapshot does not include sqlite-db.",
    };
  }

  let restoreDb: DatabaseSync | null = null;
  try {
    restoreDb = new DatabaseSync(input.snapshotDbPath);
    const integrityRow = restoreDb.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
    const integrity = String(integrityRow?.integrity_check ?? "unknown");
    const requiredTables = ["guild_templates", "guild_backup_snapshots", "settings"];
    const foundRows = restoreDb
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name IN (${requiredTables.map(() => "?").join(",")})`,
      )
      .all(...requiredTables) as Array<{ name: string }>;
    const found = new Set(foundRows.map((row) => row.name));
    const requiredTablesPresent = requiredTables.every((table) => found.has(table));
    return {
      status: integrity === "ok" && requiredTablesPresent ? "verified" : "failed",
      checkedAt: input.checkedAt,
      integrity,
      requiredTablesPresent,
      ...(integrity === "ok" && requiredTablesPresent
        ? {}
        : { error: `Restore proof failed: integrity=${integrity}, requiredTablesPresent=${requiredTablesPresent}` }),
    };
  } catch (err) {
    return {
      status: "failed",
      checkedAt: input.checkedAt,
      integrity: "error",
      requiredTablesPresent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    restoreDb?.close();
  }
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
    restoreProof: null,
  };

  try {
    fs.mkdirSync(snapshotDir, { recursive: true });
    const files = [
      copyIfExists(input.dbPath, snapshotDir, "sqlite-db"),
      copyIfExists(`${input.dbPath}-wal`, snapshotDir, "sqlite-wal"),
      copyIfExists(`${input.dbPath}-shm`, snapshotDir, "sqlite-shm"),
      copyIfExists(path.join(input.logsDir, "security-audit.ndjson"), snapshotDir, "security-audit"),
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));
    const restoreProof = verifySnapshotRestore({
      snapshotDbPath: files.find((file) => file.key === "sqlite-db")?.target ?? null,
      checkedAt: input.now,
    });
    manifest = { ...manifest, files, pruned: pruneOldSnapshots(backupRoot, input.now, retentionDays), restoreProof };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    if (restoreProof.status !== "verified") {
      throw new Error(restoreProof.error ?? "Snapshot restore proof failed.");
    }

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
