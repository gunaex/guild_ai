import type { DatabaseSync } from "node:sqlite";

type DbLike = Pick<DatabaseSync, "exec">;

export function applyGuildAiSchema(db: DbLike): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS guild_templates (
  guild_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  business_type TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  template_json TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()*1000),
  updated_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_agent_roles (
  guild_id TEXT NOT NULL REFERENCES guild_templates(guild_id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  role_key TEXT NOT NULL CHECK(role_key IN ('pm','techLead','worker','qa','hr','accounting')),
  display_name TEXT NOT NULL,
  model TEXT NOT NULL,
  reports_to TEXT,
  budget_usd_daily REAL,
  productivity_floor INTEGER,
  tools_json TEXT NOT NULL DEFAULT '[]',
  schedule TEXT,
  created_at INTEGER DEFAULT (unixepoch()*1000),
  PRIMARY KEY (guild_id, agent_id)
);

CREATE TABLE IF NOT EXISTS guild_runtime_bindings (
  guild_id TEXT NOT NULL,
  guild_agent_id TEXT NOT NULL,
  runtime_agent_id TEXT NOT NULL,
  api_provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at INTEGER DEFAULT (unixepoch()*1000),
  updated_at INTEGER DEFAULT (unixepoch()*1000),
  PRIMARY KEY (guild_id, guild_agent_id)
);

CREATE TABLE IF NOT EXISTS guild_token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_model_pricing (
  guild_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_usd_per_million REAL NOT NULL DEFAULT 0,
  completion_usd_per_million REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER DEFAULT (unixepoch()*1000),
  updated_at INTEGER DEFAULT (unixepoch()*1000),
  PRIMARY KEY (guild_id, provider, model)
);

CREATE TABLE IF NOT EXISTS guild_revenue_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  customer_name TEXT,
  description TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  received_to TEXT NOT NULL DEFAULT 'cash' CHECK(received_to IN ('cash','accounts_receivable')),
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_ai_credit_topups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  paid_from TEXT NOT NULL DEFAULT 'cash' CHECK(paid_from IN ('cash','accounts_payable','owner_capital')),
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_ai_limit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT,
  agent_id TEXT,
  api_provider_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  limit_type TEXT NOT NULL DEFAULT 'rate_limit' CHECK(limit_type IN ('rate_limit','quota_exceeded','billing','unknown')),
  status_code INTEGER,
  message TEXT NOT NULL,
  retry_after_ms INTEGER,
  active_until INTEGER,
  recovered_at INTEGER,
  source_type TEXT NOT NULL DEFAULT 'api_provider',
  source_id TEXT,
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_budget_policies (
  guild_id TEXT PRIMARY KEY,
  daily_budget_usd REAL NOT NULL DEFAULT 10,
  monthly_budget_usd REAL NOT NULL DEFAULT 300,
  hard_stop_enabled INTEGER NOT NULL DEFAULT 1 CHECK(hard_stop_enabled IN (0,1)),
  warn_threshold_percent INTEGER NOT NULL DEFAULT 80 CHECK(warn_threshold_percent BETWEEN 1 AND 100),
  updated_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_backup_snapshots (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  backup_dir TEXT NOT NULL,
  retention_days INTEGER NOT NULL DEFAULT 14,
  status TEXT NOT NULL CHECK(status IN ('succeeded','failed')),
  manifest_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_worker_queue (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  task_id TEXT,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 3,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  run_after INTEGER,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()*1000),
  updated_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_community_sessions (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','skipped','failed')),
  summary TEXT NOT NULL DEFAULT '',
  insight_json TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_community_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES guild_community_sessions(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  agent_id TEXT,
  agent_name TEXT NOT NULL,
  role_key TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'chat' CHECK(message_type IN ('chat','insight','recommendation','system')),
  content TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_memory_records (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('sqlite','chroma')),
  namespace TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  embedding_ref TEXT,
  quality_status TEXT NOT NULL DEFAULT 'draft' CHECK(quality_status IN ('draft','reviewed','approved','deprecated','archived')),
  confidence_score REAL,
  source_type TEXT,
  approved_by TEXT,
  approved_at INTEGER,
  valid_until INTEGER,
  risk_level TEXT NOT NULL DEFAULT 'normal' CHECK(risk_level IN ('low','normal','high','critical')),
  supersedes_memory_id TEXT,
  deprecated_at INTEGER,
  archived_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_eval_cases (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  task_description TEXT NOT NULL,
  expected_behavior TEXT NOT NULL,
  rubric_json TEXT NOT NULL DEFAULT '{}',
  tags_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at INTEGER DEFAULT (unixepoch()*1000),
  updated_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_eval_runs (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  case_id TEXT REFERENCES guild_eval_cases(id) ON DELETE SET NULL,
  model_provider TEXT,
  model_name TEXT,
  prompt_version_id TEXT,
  policy_version_id TEXT,
  memory_snapshot_id TEXT,
  output_text TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL CHECK(verdict IN ('pass','warn','fail','skipped')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_prompt_versions (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('worker','qa','pm','sgm','hr','community','accounting','routing')),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  content TEXT NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','deprecated','archived')),
  created_by TEXT,
  created_at INTEGER DEFAULT (unixepoch()*1000),
  activated_at INTEGER,
  deprecated_at INTEGER
);

CREATE TABLE IF NOT EXISTS guild_policy_versions (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  policy_type TEXT NOT NULL CHECK(policy_type IN ('routing','qa_rubric','budget','memory','hr_scoring','accounting','security','self_improvement')),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  content_json TEXT NOT NULL DEFAULT '{}',
  checksum TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','deprecated','archived')),
  created_by TEXT,
  created_at INTEGER DEFAULT (unixepoch()*1000),
  activated_at INTEGER,
  deprecated_at INTEGER
);

CREATE TABLE IF NOT EXISTS guild_review_queue (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  review_type TEXT NOT NULL CHECK(review_type IN ('self_improvement','hr_governance','memory_quality','policy_change','prompt_change','budget_exception','security_exception','accounting_adjustment','eval_regression','manual')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  source_table TEXT,
  source_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_review','approved','rejected','needs_info','cancelled')),
  requested_by TEXT,
  assigned_to TEXT,
  decision TEXT,
  decision_reason TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER DEFAULT (unixepoch()*1000),
  updated_at INTEGER DEFAULT (unixepoch()*1000),
  decided_at INTEGER
);

CREATE TABLE IF NOT EXISTS guild_hr_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  productivity_score INTEGER NOT NULL,
  token_cost_usd REAL NOT NULL DEFAULT 0,
  review_date TEXT NOT NULL,
  scoring_source TEXT NOT NULL DEFAULT 'manual' CHECK(scoring_source IN ('manual','auto')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER DEFAULT (unixepoch()*1000),
  UNIQUE(guild_id, agent_id, review_date)
);

CREATE TABLE IF NOT EXISTS guild_governance_requests (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK(request_type IN ('termination','budget_override','human_decision','capability_upgrade')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  decided_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_capability_levels (
  guild_id TEXT PRIMARY KEY,
  current_level INTEGER NOT NULL DEFAULT 1 CHECK(current_level BETWEEN 1 AND 5),
  max_approved_level INTEGER NOT NULL DEFAULT 1 CHECK(max_approved_level BETWEEN 1 AND 5),
  capability_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_upgrade_proposals (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  proposed_by_agent_id TEXT,
  capability_area TEXT NOT NULL,
  target_level INTEGER NOT NULL CHECK(target_level BETWEEN 1 AND 5),
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  risk_json TEXT NOT NULL DEFAULT '{}',
  expected_benefit_json TEXT NOT NULL DEFAULT '{}',
  rollback_plan TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','sandbox','needs_info','applied','cancelled')),
  human_decision_note TEXT,
  decided_by TEXT,
  decided_at INTEGER,
  applied_at INTEGER,
  outcome_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER DEFAULT (unixepoch()*1000),
  updated_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_upgrade_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id TEXT NOT NULL REFERENCES guild_upgrade_proposals(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  note TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_human_advice (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  advisor_agent_id TEXT,
  category TEXT NOT NULL CHECK(category IN ('learning','delegation','finance','strategy','operations','risk')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
  title TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  learning_resources_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','deferred','completed','dismissed')),
  created_at INTEGER DEFAULT (unixepoch()*1000),
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS guild_pm_daily_reports (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  report_date TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  markdown TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'scheduler' CHECK(source IN ('scheduler','manual','doctor')),
  created_at INTEGER DEFAULT (unixepoch()*1000),
  UNIQUE(guild_id, report_date)
);

CREATE TABLE IF NOT EXISTS guild_accounting_accounts (
  guild_id TEXT NOT NULL,
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_name_th TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('asset','liability','equity','revenue','expense')),
  normal_balance TEXT NOT NULL CHECK(normal_balance IN ('debit','credit')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at INTEGER DEFAULT (unixepoch()*1000),
  PRIMARY KEY (guild_id, account_code)
);

CREATE TABLE IF NOT EXISTS guild_accounting_journal_entries (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  description TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS guild_accounting_journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL REFERENCES guild_accounting_journal_entries(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  account_code TEXT NOT NULL,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  memo TEXT,
  created_at INTEGER DEFAULT (unixepoch()*1000),
  CHECK(debit >= 0 AND credit >= 0),
  CHECK((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE INDEX IF NOT EXISTS idx_guild_agent_roles_role ON guild_agent_roles(guild_id, role_key);
CREATE INDEX IF NOT EXISTS idx_guild_runtime_bindings_runtime_agent ON guild_runtime_bindings(runtime_agent_id);
CREATE INDEX IF NOT EXISTS idx_guild_token_usage_guild_created ON guild_token_usage(guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_model_pricing_lookup ON guild_model_pricing(guild_id, provider, model);
CREATE INDEX IF NOT EXISTS idx_guild_revenue_records_guild_created ON guild_revenue_records(guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_ai_credit_topups_guild_created ON guild_ai_credit_topups(guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_ai_limit_events_active ON guild_ai_limit_events(api_provider_id, model, active_until, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_ai_limit_events_guild_created ON guild_ai_limit_events(guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_backup_snapshots_guild_created ON guild_backup_snapshots(guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_worker_queue_status ON guild_worker_queue(guild_id, status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_community_sessions_guild_created ON guild_community_sessions(guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_community_messages_session ON guild_community_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_memory_records_lookup ON guild_memory_records(guild_id, namespace, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_eval_cases_guild ON guild_eval_cases(guild_id, enabled, updated_at);
CREATE INDEX IF NOT EXISTS idx_guild_eval_runs_guild_created ON guild_eval_runs(guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_prompt_versions_lookup ON guild_prompt_versions(guild_id, scope, status, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_policy_versions_lookup ON guild_policy_versions(guild_id, policy_type, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_guild_prompt_versions_active ON guild_prompt_versions(guild_id, scope) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_guild_policy_versions_active ON guild_policy_versions(guild_id, policy_type) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_guild_review_queue_status ON guild_review_queue(guild_id, status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_hr_reviews_agent ON guild_hr_reviews(guild_id, agent_id, review_date);
CREATE INDEX IF NOT EXISTS idx_guild_upgrade_proposals_status ON guild_upgrade_proposals(guild_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_human_advice_status ON guild_human_advice(guild_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_guild_pm_daily_reports_guild_date ON guild_pm_daily_reports(guild_id, report_date);
CREATE INDEX IF NOT EXISTS idx_guild_accounting_accounts_category ON guild_accounting_accounts(guild_id, category);
CREATE INDEX IF NOT EXISTS idx_guild_accounting_journal_lines_entry ON guild_accounting_journal_lines(entry_id);
`);

  try {
    db.exec("ALTER TABLE guild_ai_limit_events ADD COLUMN recovered_at INTEGER");
  } catch {
    /* already exists */
  }
  try {
    db.exec("ALTER TABLE guild_hr_reviews ADD COLUMN scoring_source TEXT NOT NULL DEFAULT 'manual' CHECK(scoring_source IN ('manual','auto'))");
  } catch {
    /* already exists */
  }
  try {
    db.exec("ALTER TABLE guild_hr_reviews ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}'");
  } catch {
    /* already exists */
  }
  for (const statement of [
    "ALTER TABLE guild_memory_records ADD COLUMN quality_status TEXT NOT NULL DEFAULT 'draft' CHECK(quality_status IN ('draft','reviewed','approved','deprecated','archived'))",
    "ALTER TABLE guild_memory_records ADD COLUMN confidence_score REAL",
    "ALTER TABLE guild_memory_records ADD COLUMN source_type TEXT",
    "ALTER TABLE guild_memory_records ADD COLUMN approved_by TEXT",
    "ALTER TABLE guild_memory_records ADD COLUMN approved_at INTEGER",
    "ALTER TABLE guild_memory_records ADD COLUMN valid_until INTEGER",
    "ALTER TABLE guild_memory_records ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'normal' CHECK(risk_level IN ('low','normal','high','critical'))",
    "ALTER TABLE guild_memory_records ADD COLUMN supersedes_memory_id TEXT",
    "ALTER TABLE guild_memory_records ADD COLUMN deprecated_at INTEGER",
    "ALTER TABLE guild_memory_records ADD COLUMN archived_at INTEGER",
  ]) {
    try {
      db.exec(statement);
    } catch {
      /* already exists */
    }
  }
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_guild_memory_records_quality ON guild_memory_records(guild_id, quality_status, risk_level, created_at)");
  } catch {
    /* legacy DB may need a later restart after columns are added */
  }
}
