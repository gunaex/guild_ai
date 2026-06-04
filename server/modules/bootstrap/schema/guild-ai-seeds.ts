import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { seedStarterChartOfAccounts } from "../../guild-ai/accounting.ts";
import { validateGuildTemplate, type GuildTemplateInput } from "../../guild-ai/templates.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SERVER_DIR, "..", "..", "..", "..");
const DEFAULT_TEMPLATE_DIR = path.join(REPO_ROOT, "templates", "guild-ai");

export function seedGuildAiTemplates(db: DbLike, nowMs: () => number): void {
  if (!fs.existsSync(DEFAULT_TEMPLATE_DIR)) return;

  const files = fs
    .readdirSync(DEFAULT_TEMPLATE_DIR)
    .filter((file) => file.endsWith(".guild.json"))
    .sort();

  for (const file of files) {
    const templatePath = path.join(DEFAULT_TEMPLATE_DIR, file);
    const raw = fs.readFileSync(templatePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const validation = validateGuildTemplate(parsed);
    if (!validation.ok) {
      console.warn(`[Guild AI] Skipped template seed ${file}: ${validation.error}`);
      continue;
    }

    const existing = db.prepare("SELECT 1 FROM guild_templates WHERE guild_id = ? LIMIT 1").get(validation.template.guildId) as
      | { 1: number }
      | undefined;
    if (existing) {
      seedStarterChartOfAccounts(db, validation.template.guildId);
      continue;
    }

    insertGuildTemplate(db, validation.template, nowMs());
    console.log(`[Guild AI] Seeded guild template: ${validation.template.guildId}`);
  }
}

export function insertGuildTemplate(db: DbLike, template: GuildTemplateInput, timestamp: number): void {
  db.prepare(
    `INSERT INTO guild_templates (guild_id, name, business_type, currency, template_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       name = excluded.name,
       business_type = excluded.business_type,
       currency = excluded.currency,
       template_json = excluded.template_json,
       updated_at = excluded.updated_at`,
  ).run(
    template.guildId,
    template.name,
    template.businessType,
    template.currency ?? "USD",
    JSON.stringify(template),
    timestamp,
    timestamp,
  );

  db.prepare("DELETE FROM guild_agent_roles WHERE guild_id = ?").run(template.guildId);
  const insertRole = db.prepare(
    `INSERT INTO guild_agent_roles (
      guild_id, agent_id, role_key, display_name, model, reports_to,
      budget_usd_daily, productivity_floor, tools_json, schedule, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const agent of template.agents) {
    insertRole.run(
      template.guildId,
      agent.id,
      agent.role,
      agent.displayName,
      agent.model,
      agent.reportsTo ?? null,
      agent.budgetUsdDaily ?? null,
      agent.productivityFloor ?? null,
      JSON.stringify(agent.tools ?? []),
      agent.schedule ?? null,
      timestamp,
    );
  }

  db.prepare(
    `INSERT OR IGNORE INTO guild_capability_levels (guild_id, current_level, max_approved_level, capability_json, updated_at)
     VALUES (?, 1, 1, ?, ?)`,
  ).run(
    template.guildId,
    JSON.stringify({
      selfReview: false,
      sandboxExperiments: false,
      productionSelfUpgrade: false,
    }),
    timestamp,
  );

  seedStarterChartOfAccounts(db, template.guildId);
}
