import type { DatabaseSync } from "node:sqlite";
import { buildGuildVisualManifest, type GuildVisualManifest } from "./visual-manifest.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildVisualBridgeSnapshot = {
  version: 1;
  guildId: string;
  generatedAt: number;
  sequence: string;
  subscribeMode: "poll";
  recommendedPollMs: number;
  manifest: GuildVisualManifest;
};

function latestUpdatedAt(db: DbLike, guildId: string): number {
  const rows = [
    db.prepare("SELECT COALESCE(MAX(updated_at), 0) AS ts FROM guild_templates WHERE guild_id = ?").get(guildId),
    db.prepare("SELECT COALESCE(MAX(updated_at), 0) AS ts FROM guild_runtime_bindings WHERE guild_id = ?").get(guildId),
    db.prepare("SELECT COALESCE(MAX(updated_at), 0) AS ts FROM guild_upgrade_proposals WHERE guild_id = ?").get(guildId),
    db.prepare("SELECT COALESCE(MAX(created_at), 0) AS ts FROM guild_accounting_journal_entries WHERE guild_id = ?").get(guildId),
    db.prepare("SELECT COALESCE(MAX(created_at), 0) AS ts FROM guild_human_advice WHERE guild_id = ?").get(guildId),
  ] as Array<{ ts: number } | undefined>;
  return Math.max(...rows.map((row) => Number(row?.ts ?? 0)));
}

export function buildGuildVisualBridgeSnapshot(
  db: DbLike,
  input: { guildId: string; generatedAt: number },
): GuildVisualBridgeSnapshot {
  const manifest = buildGuildVisualManifest(db, input.guildId, input.generatedAt);
  const sequence = `${input.guildId}:${latestUpdatedAt(db, input.guildId)}:${manifest.actors.length}:${manifest.tasks.inProgress}:${manifest.tasks.review}:${manifest.governance.pendingUpgrades}`;
  return {
    version: 1,
    guildId: input.guildId,
    generatedAt: input.generatedAt,
    sequence,
    subscribeMode: "poll",
    recommendedPollMs: manifest.tasks.inProgress > 0 || manifest.tasks.review > 0 ? 2000 : 5000,
    manifest,
  };
}
