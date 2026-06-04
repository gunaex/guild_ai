import fs from "node:fs";
import path from "node:path";

export type GuildBackupItem = {
  key: "sqlite_db" | "sqlite_wal" | "sqlite_shm" | "logs_dir" | "security_audit";
  path: string;
  exists: boolean;
  sizeBytes: number;
  required: boolean;
};

export type GuildBackupReadiness = {
  guildId: string;
  generatedAt: number;
  backupDir: string | null;
  backupDirReady: boolean;
  ready: boolean;
  items: GuildBackupItem[];
  manifest: {
    version: 1;
    guildId: string;
    generatedAt: number;
    files: Array<{ key: GuildBackupItem["key"]; path: string; sizeBytes: number; required: boolean }>;
  };
  nextActions: string[];
};

function statFile(filePath: string): { exists: boolean; sizeBytes: number } {
  try {
    const stat = fs.statSync(filePath);
    return { exists: stat.isFile() || stat.isDirectory(), sizeBytes: stat.isFile() ? stat.size : 0 };
  } catch {
    return { exists: false, sizeBytes: 0 };
  }
}

export function buildGuildBackupReadiness(input: {
  guildId: string;
  generatedAt: number;
  dbPath: string;
  logsDir: string;
  backupDir?: string | null;
}): GuildBackupReadiness {
  const auditPath = path.join(input.logsDir, "security-audit.ndjson");
  const items: GuildBackupItem[] = [
    { key: "sqlite_db", path: input.dbPath, required: true, ...statFile(input.dbPath) },
    { key: "sqlite_wal", path: `${input.dbPath}-wal`, required: false, ...statFile(`${input.dbPath}-wal`) },
    { key: "sqlite_shm", path: `${input.dbPath}-shm`, required: false, ...statFile(`${input.dbPath}-shm`) },
    { key: "logs_dir", path: input.logsDir, required: true, ...statFile(input.logsDir) },
    { key: "security_audit", path: auditPath, required: false, ...statFile(auditPath) },
  ];
  const backupDir = input.backupDir?.trim() || null;
  const backupDirReady = backupDir ? fs.existsSync(backupDir) : false;
  const missingRequired = items.filter((item) => item.required && !item.exists);
  const ready = missingRequired.length === 0 && backupDirReady;
  const nextActions: string[] = [];
  if (!backupDir) nextActions.push("Set GUILD_AI_BACKUP_DIR to a private backup directory.");
  else if (!backupDirReady) nextActions.push(`Create backup directory: ${backupDir}`);
  if (missingRequired.length > 0) {
    nextActions.push(`Missing required backup source(s): ${missingRequired.map((item) => item.key).join(", ")}.`);
  }
  if (!items.find((item) => item.key === "security_audit")?.exists) {
    nextActions.push("Run the server long enough to create security-audit.ndjson, then include it in backups.");
  }
  if (nextActions.length === 0) nextActions.push("Backup manifest is ready; copy listed files with the server stopped or using SQLite backup tooling.");

  return {
    guildId: input.guildId,
    generatedAt: input.generatedAt,
    backupDir,
    backupDirReady,
    ready,
    items,
    manifest: {
      version: 1,
      guildId: input.guildId,
      generatedAt: input.generatedAt,
      files: items.map((item) => ({
        key: item.key,
        path: item.path,
        sizeBytes: item.sizeBytes,
        required: item.required,
      })),
    },
    nextActions,
  };
}
