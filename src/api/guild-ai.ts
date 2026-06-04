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
  readiness: Array<{
    key: "runtime" | "limits" | "smoke" | "accounting" | "governance" | "memory";
    label: string;
    status: "ready" | "action_needed" | "watch";
    detail: string;
  }>;
  metrics: {
    actors: number;
    pendingUpgrades: number;
    plannedTasks: number;
    netIncome: number;
    runtimeAvailable: number;
    runtimeLimited: number;
    memoryRecords: number;
    hrReviews: number;
    pendingGovernanceRequests: number;
  };
};

export type GuildAiAuditReplay = {
  guildId: string;
  generatedAt: number;
  events: Array<{
    ts: number;
    source: "task" | "task_log" | "journal" | "limit" | "hr" | "memory" | "governance";
    title: string;
    detail: string;
    refId: string | number | null;
  }>;
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

export type GuildAiMemoryNamespace = "operations" | "governance" | "accounting" | "runtime" | "customer" | "learning";

export type GuildAiMemoryRecord = {
  id: string;
  guild_id: string;
  provider: "sqlite" | "chroma";
  namespace: GuildAiMemoryNamespace;
  content: string;
  metadata_json: string;
  embedding_ref: string | null;
  created_at: number;
};

export type GuildAiVectorMemoryStatus = {
  provider: "sqlite" | "chroma";
  enabled: boolean;
  ready: boolean;
  endpoint: string | null;
  collection: string;
  detail: string;
};

export type GuildAiDeploymentReadiness = {
  guildId: string;
  generatedAt: number;
  mode: "local" | "lan" | "internet";
  host: string;
  port: number;
  localOnly: boolean;
  readyForLan: boolean;
  readyForInternet: boolean;
  gates: Array<{
    key: "binding" | "auth" | "origin" | "csrf" | "audit" | "dev_server" | "internet";
    label: string;
    status: "ready" | "watch" | "blocked";
    detail: string;
  }>;
  nextActions: string[];
};

export type GuildAiBackupReadiness = {
  guildId: string;
  generatedAt: number;
  backupDir: string | null;
  backupDirReady: boolean;
  ready: boolean;
  items: Array<{
    key: "sqlite_db" | "sqlite_wal" | "sqlite_shm" | "logs_dir" | "security_audit";
    path: string;
    exists: boolean;
    sizeBytes: number;
    required: boolean;
  }>;
  manifest: {
    version: 1;
    guildId: string;
    generatedAt: number;
    files: Array<{ key: string; path: string; sizeBytes: number; required: boolean }>;
  };
  nextActions: string[];
};

export type GuildAiLaunchReadiness = {
  guildId: string;
  generatedAt: number;
  status: "ready_for_today" | "needs_attention" | "blocked";
  score: number;
  fullVisionPercent: number;
  localMvpPercent: number;
  gates: Array<{
    key: "template" | "runtime" | "accounting" | "smoke" | "memory" | "hr" | "deployment" | "backup";
    label: string;
    status: "ready" | "watch" | "blocked";
    detail: string;
    critical: boolean;
  }>;
  nextActions: string[];
};

export type GuildAiPmDailyReport = {
  id: string;
  guildId: string;
  reportDate: string;
  generatedAt: number;
  summary: {
    guildId: string;
    reportDate: string;
    generatedAt: number;
    launchStatus: "ready_for_today" | "needs_attention" | "blocked";
    launchScore: number;
    tasks: {
      created24h: number;
      done24h: number;
      review24h: number;
      inProgress: number;
      blocked: number;
    };
    finance: {
      revenue: number;
      expense: number;
      netIncome: number;
      tokenCost: number;
      tokens24h: number;
    };
    operations: {
      activeRuntimeBindings: number;
      activeModelLimits: number;
      pendingGovernanceRequests: number;
      openAdvice: number;
      memoryRecords: number;
      averageProductivityScore: number | null;
    };
    nextActions: string[];
  };
  markdown: string;
  source: "scheduler" | "manual" | "doctor";
  createdAt: number;
};

export type GuildAiHrReview = {
  id: number;
  guild_id: string;
  agent_id: string;
  productivity_score: number;
  token_cost_usd: number;
  review_date: string;
  scoring_source?: "manual" | "auto";
  evidence_json?: string;
  created_at: number;
};

export type GuildAiGovernanceRequest = {
  id: string;
  guild_id: string;
  agent_id: string;
  request_type: "termination" | "budget_override" | "human_decision" | "capability_upgrade";
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string;
  evidence_json: string;
  decided_at: number | null;
  created_at: number;
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
  status: string;
};

export type GuildAiTaskSmokeSummary = {
  taskId: string;
  guildId: string;
  roleKey: string;
  title: string;
  status: string;
  projectId: string | null;
  projectPath: string | null;
  runtimeAgentId: string | null;
  runtimeAgentName: string | null;
  createdAt: number;
  updatedAt: number;
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

export type GuildAiTaskArtifactSnapshot = {
  ok: boolean;
  taskId: string;
  guildId: string;
  projectPath: string;
  artifacts: Array<{
    name: "GUILD_SMOKE.md" | "SMOKE_RESULT.md";
    exists: boolean;
    content: string;
    updatedAt: number | null;
  }>;
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

export async function getGuildAiAuditReplay(
  guildId: string,
  input?: { since?: number; limit?: number },
): Promise<{ ok: boolean; replay: GuildAiAuditReplay }> {
  const params = new URLSearchParams();
  if (input?.since) params.set("since", String(input.since));
  if (input?.limit) params.set("limit", String(input.limit));
  const query = params.toString();
  return request(`/api/guild-ai/audit/${encodeURIComponent(guildId)}/replay${query ? `?${query}` : ""}`);
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

export async function listGuildAiMemories(
  guildId: string,
  input?: { namespace?: GuildAiMemoryNamespace; limit?: number },
): Promise<{ ok: boolean; guildId: string; provider: "sqlite"; records: GuildAiMemoryRecord[] }> {
  const params = new URLSearchParams();
  if (input?.namespace) params.set("namespace", input.namespace);
  if (input?.limit) params.set("limit", String(input.limit));
  const query = params.toString();
  return request(`/api/guild-ai/memory/${encodeURIComponent(guildId)}${query ? `?${query}` : ""}`);
}

export async function getGuildAiVectorMemoryStatus(
  guildId: string,
): Promise<{ ok: boolean; guildId: string; status: GuildAiVectorMemoryStatus }> {
  return request(`/api/guild-ai/memory/${encodeURIComponent(guildId)}/vector-status`);
}

export async function queryGuildAiRagMemory(
  guildId: string,
  input: { query: string; limit?: number },
): Promise<{
  ok: boolean;
  guildId: string;
  result: { provider: "sqlite" | "chroma"; query: string; records: GuildAiMemoryRecord[]; status: GuildAiVectorMemoryStatus };
}> {
  const limit = input.limit ?? 8;
  return request(
    `/api/guild-ai/memory/${encodeURIComponent(guildId)}/rag?query=${encodeURIComponent(input.query)}&limit=${encodeURIComponent(limit)}`,
  );
}

export async function createGuildAiMemory(input: {
  guildId: string;
  namespace: GuildAiMemoryNamespace;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean; guildId: string; record: GuildAiMemoryRecord }> {
  return post("/api/guild-ai/memory", input);
}

export async function listGuildAiHrReviews(
  guildId: string,
  input?: { limit?: number },
): Promise<{ ok: boolean; guildId: string; reviews: GuildAiHrReview[] }> {
  const limit = input?.limit ?? 20;
  return request(`/api/guild-ai/hr/${encodeURIComponent(guildId)}/reviews?limit=${encodeURIComponent(limit)}`);
}

export async function recordGuildAiHrReview(input: {
  guildId: string;
  agentId: string;
  productivityScore: number;
  tokenCostUsd?: number;
  reviewDate?: string;
}): Promise<{
  ok: boolean;
  guildId: string;
  review: GuildAiHrReview;
  governanceRequest: GuildAiGovernanceRequest | null;
  productivityFloor: number;
}> {
  return post("/api/guild-ai/hr/reviews", input);
}

export async function scoreGuildAiDailyProductivity(
  guildId: string,
): Promise<{ ok: boolean; guildId: string; results: Array<{ review: GuildAiHrReview; productivityFloor: number }> }> {
  return post(`/api/guild-ai/hr/${encodeURIComponent(guildId)}/score-daily`, {});
}

export async function listGuildAiGovernanceRequests(
  guildId: string,
  input?: { limit?: number },
): Promise<{ ok: boolean; guildId: string; requests: GuildAiGovernanceRequest[] }> {
  const limit = input?.limit ?? 20;
  return request(`/api/guild-ai/governance/${encodeURIComponent(guildId)}/requests?limit=${encodeURIComponent(limit)}`);
}

export async function decideGuildAiGovernanceRequest(
  requestId: string,
  input: { decision: "approved" | "rejected" | "cancelled"; note?: string },
): Promise<{ ok: boolean; request: GuildAiGovernanceRequest }> {
  return post(`/api/guild-ai/governance/${encodeURIComponent(requestId)}/decision`, input);
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

export async function getGuildAiDeploymentReadiness(
  guildId: string,
): Promise<{ ok: boolean; readiness: GuildAiDeploymentReadiness }> {
  return request(`/api/guild-ai/deployment/${encodeURIComponent(guildId)}/readiness`);
}

export async function getGuildAiBackupReadiness(
  guildId: string,
): Promise<{ ok: boolean; readiness: GuildAiBackupReadiness }> {
  return request(`/api/guild-ai/backup/${encodeURIComponent(guildId)}/readiness`);
}

export async function getGuildAiLaunchReadiness(
  guildId: string,
): Promise<{ ok: boolean; readiness: GuildAiLaunchReadiness }> {
  return request(`/api/guild-ai/launch/${encodeURIComponent(guildId)}/readiness`);
}

export async function getLatestGuildAiPmDailyReport(
  guildId: string,
): Promise<{ ok: boolean; guildId: string; report: GuildAiPmDailyReport | null }> {
  return request(`/api/guild-ai/reports/${encodeURIComponent(guildId)}/daily/latest`);
}

export async function generateGuildAiPmDailyReport(
  guildId: string,
): Promise<{ ok: boolean; guildId: string; report: GuildAiPmDailyReport }> {
  return post(`/api/guild-ai/reports/${encodeURIComponent(guildId)}/daily/generate`, {});
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

export async function listGuildAiTaskSmokes(
  guildId: string,
  input?: { limit?: number },
): Promise<{ ok: boolean; guildId: string; tasks: GuildAiTaskSmokeSummary[] }> {
  const limit = input?.limit ?? 10;
  return request(`/api/guild-ai/runtime/${encodeURIComponent(guildId)}/task-smokes?limit=${encodeURIComponent(limit)}`);
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

export async function getGuildAiTaskArtifacts(
  taskId: string,
  input: { guildId: string },
): Promise<GuildAiTaskArtifactSnapshot> {
  return request(
    `/api/guild-ai/tasks/${encodeURIComponent(taskId)}/artifacts?guildId=${encodeURIComponent(input.guildId)}`,
  );
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
