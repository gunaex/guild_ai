import { post, request } from "./core";

export type GuildAiAccountingCategory = {
  key: "asset" | "liability" | "equity" | "revenue" | "expense";
  name: string;
  nameTh: string;
  normalBalance: "debit" | "credit";
};

export type GuildAiTemplateSummary = {
  guild_id: string;
  name: string;
  business_type: string;
  currency: string;
  created_at: number;
  updated_at: number;
};

export type GuildAiCapability = {
  guild_id: string;
  current_level: number;
  max_approved_level: number;
  capability_json: string;
  updated_at: number;
};

export type GuildAiSgmBriefing = {
  guildId: string;
  generatedAt: number;
  headline: string;
  status: "ready" | "needs_decision" | "watch_cost" | "warming_up";
  bullets: string[];
  nextActions: Array<{
    key: string;
    label: string;
    priority: "low" | "medium" | "high";
  }>;
  metrics: {
    actors: number;
    pendingUpgrades: number;
    plannedTasks: number;
    netIncome: number;
    runtimeAvailable: number;
    runtimeLimited: number;
  };
};

export type GuildAiUpgradeProposal = {
  id: string;
  guild_id: string;
  proposed_by_agent_id: string | null;
  capability_area: string;
  target_level: number;
  title: string;
  rationale: string;
  risk_json: string;
  expected_benefit_json: string;
  rollback_plan: string | null;
  status: "pending" | "approved" | "rejected" | "sandbox" | "needs_info" | "applied" | "cancelled";
  human_decision_note: string | null;
  decided_by: string | null;
  decided_at: number | null;
  applied_at: number | null;
  outcome_json: string;
  created_at: number;
  updated_at: number;
};

export type GuildAiUpgradeEvent = {
  id: number;
  proposal_id: string;
  event_type: string;
  note: string | null;
  payload_json: string;
  created_at: number;
};

export type GuildAiAdvice = {
  id: string;
  guild_id: string;
  advisor_agent_id: string | null;
  category: "learning" | "delegation" | "finance" | "strategy" | "operations" | "risk";
  priority: "low" | "medium" | "high" | "urgent";
  title: string;
  recommendation: string;
  learning_resources_json: string;
  evidence_json: string;
  status: "open" | "accepted" | "deferred" | "completed" | "dismissed";
  created_at: number;
  resolved_at: number | null;
};

export type GuildAiRuntimeBinding = {
  guild_id: string;
  guild_agent_id: string;
  guild_role_key: string;
  guild_display_name: string;
  runtime_agent_id: string;
  runtime_agent_name: string;
  api_provider_id: string;
  api_provider_name: string;
  model: string;
  status: "active" | "disabled";
  availability_status?: "available" | "limited" | "disabled";
  active_limit?: {
    id: number;
    limitType: string;
    message: string;
    activeUntil: number | null;
  } | null;
  updated_at: number;
};

export type GuildAiRuntimeSmokeResult = {
  ok: boolean;
  guildId: string;
  roleKey: string;
  runtimeAgentId: string;
  runtimeAgentName: string;
  provider?: string;
  model?: string;
  output: string;
  logPath: string;
  error?: string;
};

export type GuildAiTaskSmokeResult = {
  ok: boolean;
  guildId: string;
  roleKey: string;
  projectId: string;
  projectPath: string;
  taskId: string;
  runtimeAgentId: string;
  runtimeAgentName: string;
  status: "planned";
};

export type GuildAiTaskSmokeRunResult = {
  ok: boolean;
  taskId: string;
  guildId: string;
  roleKey: string;
  runtimeAgentId: string;
  runtimeAgentName: string;
  departmentId: string | null;
  projectPath: string;
  status: "started";
};

export type GuildAiTaskRouteDecision = "worker_done" | "qa_pass" | "qa_fail" | "techlead_escalate";

export type GuildAiTaskRouteResult = {
  ok: boolean;
  taskId: string;
  guildId: string;
  decision: GuildAiTaskRouteDecision;
  status: "planned" | "review" | "done";
  assignedAgentId: string | null;
  assignedRole: "worker" | "qa" | "techLead" | "pm" | null;
  retryCount: number;
  escalationLevel: "techLead" | "pm" | null;
};

export type GuildAiTaskSnapshot = {
  id: string;
  title: string;
  status: string;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  workflowMetaJson: string | null;
  projectPath: string | null;
  updatedAt: number;
};

export type GuildAiTaskLog = {
  id: number;
  kind: string;
  message: string;
  createdAt: number;
};

export type GuildAiTaskLogSnapshot = {
  ok: boolean;
  task: GuildAiTaskSnapshot;
  logs: GuildAiTaskLog[];
};

export type GuildAiLimitEvent = {
  id: number;
  guildId: string | null;
  agentId: string | null;
  apiProviderId: string;
  provider: string;
  model: string;
  limitType: "rate_limit" | "quota_exceeded" | "billing" | "unknown";
  statusCode: number | null;
  message: string;
  retryAfterMs: number | null;
  activeUntil: number | null;
  recoveredAt: number | null;
  sourceType: string;
  sourceId: string | null;
  createdAt: number;
};

export type GuildAiVisualManifest = {
  guildId: string;
  generatedAt: number;
  scene: {
    key: "local_ai_office";
    title: string;
    mood: string;
    palette: {
      background: string;
      accent: string;
      warning: string;
    };
  };
  actors: Array<{
    guildAgentId: string;
    roleKey: string;
    displayName: string;
    runtimeAgentId: string;
    runtimeName: string;
    providerName: string;
    model: string;
    status: string;
    visualState: string;
  }>;
  accounting: {
    revenue: number;
    expenses: number;
    netIncome: number;
    visualState: string;
  };
  governance: {
    pendingUpgrades: number;
    latestAdvice: string | null;
    visualState: string;
  };
  tasks: {
    planned: number;
    inProgress: number;
    review: number;
    done: number;
    visualState: string;
  };
};

export type GuildAiAccount = {
  account_code: string;
  account_name: string;
  account_name_th: string;
  category: GuildAiAccountingCategory["key"];
  normal_balance: "debit" | "credit";
  is_active: 0 | 1;
};

export type GuildAiModelPricing = {
  guild_id: string;
  provider: string;
  model: string;
  prompt_usd_per_million: number;
  completion_usd_per_million: number;
  currency: string;
  source: string;
  created_at: number;
  updated_at: number;
};

export type GuildAiProfitAndLoss = {
  guildId: string;
  revenue: number;
  expenses: number;
  netIncome: number;
};

export type GuildAiAccountingSummary = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type GuildAiJournalLine = {
  entry_id: string;
  account_code: string;
  account_name_th: string;
  category: GuildAiAccountingCategory["key"];
  debit: number;
  credit: number;
  memo: string | null;
};

export type GuildAiJournalEntry = {
  id: string;
  entry_date: string;
  description: string;
  source_type: string;
  source_id: string | null;
  created_at: number;
  lines: GuildAiJournalLine[];
};

export async function getGuildAiHealth(): Promise<{
  ok: boolean;
  vectorDbProvider: string;
  templates: number;
  pendingUpgrades: number;
  accountingCategories: GuildAiAccountingCategory[];
}> {
  return request("/api/guild-ai/health");
}

export async function listGuildAiTemplates(): Promise<{ ok: boolean; templates: GuildAiTemplateSummary[] }> {
  return request("/api/guild-ai/templates");
}

export async function getGuildAiCapabilities(
  guildId: string,
): Promise<{ ok: boolean; guildId: string; capability: GuildAiCapability | null }> {
  return request(`/api/guild-ai/capabilities/${encodeURIComponent(guildId)}`);
}

export async function getGuildAiBriefing(guildId: string): Promise<{ ok: boolean; briefing: GuildAiSgmBriefing }> {
  return request(`/api/guild-ai/briefing/${encodeURIComponent(guildId)}`);
}

export async function listGuildAiUpgrades(
  guildId: string,
): Promise<{ ok: boolean; guildId: string; proposals: GuildAiUpgradeProposal[] }> {
  return request(`/api/guild-ai/upgrades/${encodeURIComponent(guildId)}`);
}

export async function decideGuildAiUpgrade(
  proposalId: string,
  input: { decision: "approved" | "rejected" | "sandbox" | "needs_info" | "cancelled"; note?: string; decidedBy?: string },
): Promise<{ ok: boolean; proposalId: string; status: string }> {
  return post(`/api/guild-ai/upgrades/${encodeURIComponent(proposalId)}/decision`, input);
}

export async function createGuildAiUpgradeProposal(input: {
  guildId: string;
  proposedByAgentId?: string;
  capabilityArea: string;
  targetLevel: number;
  title: string;
  rationale: string;
  risk?: Record<string, unknown>;
  expectedBenefit?: Record<string, unknown>;
  rollbackPlan?: string;
}): Promise<{ ok: boolean; proposalId: string; status: string }> {
  return post("/api/guild-ai/upgrades/proposals", input);
}

export async function listGuildAiUpgradeEvents(
  proposalId: string,
): Promise<{ ok: boolean; proposalId: string; events: GuildAiUpgradeEvent[] }> {
  return request(`/api/guild-ai/upgrades/${encodeURIComponent(proposalId)}/events`);
}

export async function listGuildAiAdvice(
  guildId: string,
): Promise<{ ok: boolean; guildId: string; advice: GuildAiAdvice[] }> {
  return request(`/api/guild-ai/advice/${encodeURIComponent(guildId)}`);
}

export async function listGuildAiRuntimeBindings(
  guildId: string,
): Promise<{ ok: boolean; guildId: string; bindings: GuildAiRuntimeBinding[] }> {
  return request(`/api/guild-ai/runtime/${encodeURIComponent(guildId)}/bindings`);
}

export async function listGuildAiLimitEvents(
  guildId: string,
): Promise<{ ok: boolean; guildId: string; events: GuildAiLimitEvent[] }> {
  return request(`/api/guild-ai/limits/${encodeURIComponent(guildId)}`);
}

export async function getGuildAiVisualManifest(
  guildId: string,
): Promise<{ ok: boolean; manifest: GuildAiVisualManifest }> {
  return request(`/api/guild-ai/visual/${encodeURIComponent(guildId)}/manifest`);
}

export async function bootstrapGuildAiOllamaRuntime(
  guildId: string,
  input?: { model?: string; assignRuntimeAgents?: boolean },
): Promise<{
  ok: boolean;
  guildId: string;
  model: string;
  bindings: GuildAiRuntimeBinding[];
}> {
  return post(`/api/guild-ai/runtime/${encodeURIComponent(guildId)}/ollama-bootstrap`, input ?? {});
}

export async function runGuildAiRuntimeSmoke(
  guildId: string,
  input?: { roleKey?: string; message?: string },
): Promise<GuildAiRuntimeSmokeResult> {
  return post(`/api/guild-ai/runtime/${encodeURIComponent(guildId)}/smoke`, input ?? {});
}

export async function stageGuildAiTaskSmoke(
  guildId: string,
  input?: { roleKey?: string; scratchRoot?: string },
): Promise<GuildAiTaskSmokeResult> {
  return post(`/api/guild-ai/runtime/${encodeURIComponent(guildId)}/task-smoke`, input ?? {});
}

export async function runGuildAiTaskSmoke(
  taskId: string,
  input: { guildId: string },
): Promise<GuildAiTaskSmokeRunResult> {
  return post(`/api/guild-ai/tasks/${encodeURIComponent(taskId)}/run-smoke`, input);
}

export async function routeGuildAiTask(
  taskId: string,
  input: { guildId: string; decision: GuildAiTaskRouteDecision; feedback?: string; maxRetries?: number },
): Promise<GuildAiTaskRouteResult> {
  return post(`/api/guild-ai/tasks/${encodeURIComponent(taskId)}/route-decision`, input);
}

export async function getGuildAiTaskLogs(taskId: string): Promise<GuildAiTaskLogSnapshot> {
  return request(`/api/guild-ai/tasks/${encodeURIComponent(taskId)}/logs`);
}

export async function createGuildAiAdvice(input: {
  guildId: string;
  advisorAgentId?: string;
  category: GuildAiAdvice["category"];
  priority: GuildAiAdvice["priority"];
  title: string;
  recommendation: string;
  learningResources?: string[];
  evidence?: Record<string, unknown>;
}): Promise<{ ok: boolean; adviceId: string; status: string }> {
  return post("/api/guild-ai/advice", input);
}

export async function listGuildAiAccounts(guildId: string): Promise<{
  ok: boolean;
  guildId: string;
  categories: GuildAiAccountingCategory[];
  accounts: GuildAiAccount[];
}> {
  return request(`/api/guild-ai/accounting/${encodeURIComponent(guildId)}/accounts`);
}

export async function listGuildAiModelPricing(
  guildId: string,
): Promise<{ ok: boolean; guildId: string; pricing: GuildAiModelPricing[] }> {
  return request(`/api/guild-ai/accounting/${encodeURIComponent(guildId)}/model-pricing`);
}

export async function getGuildAiAccounting(guildId: string): Promise<{
  ok: boolean;
  guildId: string;
  summary: GuildAiAccountingSummary;
  prepaidAiCreditBalance: number;
  profitAndLoss: GuildAiProfitAndLoss;
}> {
  return request(`/api/guild-ai/accounting/${encodeURIComponent(guildId)}`);
}

export async function upsertGuildAiModelPricing(input: {
  guildId: string;
  provider: string;
  model: string;
  promptUsdPerMillion: number;
  completionUsdPerMillion: number;
  source?: string;
}): Promise<{ ok: boolean; guildId: string; pricing: GuildAiModelPricing }> {
  return post("/api/guild-ai/accounting/model-pricing", input);
}

export async function getGuildAiProfitAndLoss(guildId: string): Promise<{ ok: boolean } & GuildAiProfitAndLoss> {
  return request(`/api/guild-ai/accounting/${encodeURIComponent(guildId)}/pnl`);
}

export async function listGuildAiJournal(
  guildId: string,
): Promise<{ ok: boolean; guildId: string; entries: GuildAiJournalEntry[] }> {
  return request(`/api/guild-ai/accounting/${encodeURIComponent(guildId)}/journal`);
}

export async function recordGuildAiTokenUsage(input: {
  guildId: string;
  agentId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  paidFrom?: "accounts_payable" | "prepaid_ai_credits";
}): Promise<{
  ok: boolean;
  guildId: string;
  usageId: number;
  journalEntryId: string | null;
  totalTokens: number;
  costUsd: number;
}> {
  return post("/api/guild-ai/accounting/token-usage", input);
}

export async function recordGuildAiCreditTopup(input: {
  guildId: string;
  provider: string;
  description: string;
  amountUsd: number;
  paidFrom?: "cash" | "accounts_payable" | "owner_capital";
  sourceType?: string;
  sourceId?: string;
}): Promise<{
  ok: boolean;
  guildId: string;
  topupId: number;
  journalEntryId: string;
  amountUsd: number;
  prepaidAiCreditBalance: number;
}> {
  return post("/api/guild-ai/accounting/ai-credit-topup", input);
}

export async function recordGuildAiRevenue(input: {
  guildId: string;
  customerName?: string;
  description: string;
  amountUsd: number;
  receivedTo?: "cash" | "accounts_receivable";
  sourceType?: string;
  sourceId?: string;
}): Promise<{
  ok: boolean;
  guildId: string;
  revenueId: number;
  journalEntryId: string;
  amountUsd: number;
}> {
  return post("/api/guild-ai/accounting/revenue", input);
}
