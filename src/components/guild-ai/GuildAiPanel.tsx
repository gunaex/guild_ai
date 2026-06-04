import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  bootstrapGuildAiOllamaRuntime,
  createGuildAiAdvice,
  createGuildAiUpgradeProposal,
  decideGuildAiUpgrade,
  getGuildAiAccounting,
  getGuildAiBriefing,
  getGuildAiCapabilities,
  getGuildAiTaskArtifacts,
  getGuildAiHealth,
  getGuildAiTaskLogs,
  getGuildAiVisualManifest,
  listGuildAiAccounts,
  listGuildAiAdvice,
  listGuildAiJournal,
  listGuildAiLimitEvents,
  listGuildAiModelPricing,
  listGuildAiRuntimeBindings,
  listGuildAiTemplates,
  listGuildAiUpgradeEvents,
  listGuildAiUpgrades,
  recordGuildAiCreditTopup,
  recordGuildAiRevenue,
  recordGuildAiTokenUsage,
  routeGuildAiTask,
  runGuildAiTaskSmoke,
  runGuildAiRuntimeSmoke,
  stageGuildAiTaskSmoke,
  upsertGuildAiModelPricing,
  type GuildAiAccount,
  type GuildAiAccountingSummary,
  type GuildAiAdvice,
  type GuildAiCapability,
  type GuildAiUpgradeEvent,
  type GuildAiVisualManifest,
  type GuildAiJournalEntry,
  type GuildAiLimitEvent,
  type GuildAiModelPricing,
  type GuildAiProfitAndLoss,
  type GuildAiRuntimeBinding,
  type GuildAiRuntimeSmokeResult,
  type GuildAiTaskArtifactSnapshot,
  type GuildAiTaskLogSnapshot,
  type GuildAiTaskRouteDecision,
  type GuildAiTaskRouteResult,
  type GuildAiTaskSmokeRunResult,
  type GuildAiSgmBriefing,
  type GuildAiTaskSmokeResult,
  type GuildAiTemplateSummary,
  type GuildAiUpgradeProposal,
} from "../../api/guild-ai";

type LoadState = {
  templates: GuildAiTemplateSummary[];
  capability: GuildAiCapability | null;
  proposals: GuildAiUpgradeProposal[];
  advice: GuildAiAdvice[];
  accounts: GuildAiAccount[];
  accountingSummary: GuildAiAccountingSummary | null;
  prepaidAiCreditBalance: number;
  pnl: GuildAiProfitAndLoss | null;
  journal: GuildAiJournalEntry[];
  limitEvents: GuildAiLimitEvent[];
  modelPricing: GuildAiModelPricing[];
  runtimeBindings: GuildAiRuntimeBinding[];
  visualManifest: GuildAiVisualManifest | null;
  briefing: GuildAiSgmBriefing | null;
  pendingUpgrades: number;
  vectorDbProvider: string;
};

type ProposalFormState = {
  capabilityArea: string;
  targetLevel: number;
  title: string;
  rationale: string;
  riskLevel: string;
  expectedBenefit: string;
  rollbackPlan: string;
};

type AdviceFormState = {
  category: GuildAiAdvice["category"];
  priority: GuildAiAdvice["priority"];
  title: string;
  recommendation: string;
  learningResources: string;
};

type UpgradeDecision = "approved" | "rejected" | "sandbox" | "needs_info" | "cancelled";

type DecisionFormState = {
  decision: UpgradeDecision;
  decidedBy: string;
  note: string;
};

type PricingFormState = {
  provider: string;
  model: string;
  promptUsdPerMillion: string;
  completionUsdPerMillion: string;
};

const emptyState: LoadState = {
  templates: [],
  capability: null,
  proposals: [],
  advice: [],
  accounts: [],
  accountingSummary: null,
  prepaidAiCreditBalance: 0,
  pnl: null,
  journal: [],
  limitEvents: [],
  modelPricing: [],
  runtimeBindings: [],
  visualManifest: null,
  briefing: null,
  pendingUpgrades: 0,
  vectorDbProvider: "none",
};

function formatDate(ms: number | null): string {
  if (!ms) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}

function statusClass(status: string): string {
  if (status === "ready") return "border-emerald-400/40 text-emerald-200";
  if (status === "watch" || status === "action_needed") return "border-amber-400/40 text-amber-200";
  if (status === "approved" || status === "applied" || status === "completed") return "border-emerald-400/40 text-emerald-200";
  if (status === "sandbox" || status === "needs_info" || status === "deferred") return "border-amber-400/40 text-amber-200";
  if (status === "rejected" || status === "cancelled" || status === "dismissed") return "border-rose-400/40 text-rose-200";
  return "border-sky-400/40 text-sky-200";
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-600">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

const defaultProposalForm: ProposalFormState = {
  capabilityArea: "workflow-self-review",
  targetLevel: 2,
  title: "",
  rationale: "",
  riskLevel: "low",
  expectedBenefit: "",
  rollbackPlan: "",
};

const defaultAdviceForm: AdviceFormState = {
  category: "learning",
  priority: "medium",
  title: "",
  recommendation: "",
  learningResources: "",
};

const defaultDecisionForm: DecisionFormState = {
  decision: "sandbox",
  decidedBy: "SGM",
  note: "",
};

const defaultPricingForm: PricingFormState = {
  provider: "openai",
  model: "*",
  promptUsdPerMillion: "0",
  completionUsdPerMillion: "0",
};

function TextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1 text-xs text-slate-400">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1 text-xs text-slate-400">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="resize-none rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm leading-6 text-slate-100 outline-none transition focus:border-emerald-400/60"
      />
    </label>
  );
}

export default function GuildAiPanel() {
  const [state, setState] = useState<LoadState>(emptyState);
  const [selectedGuildId, setSelectedGuildId] = useState("ecom-001");
  const [loading, setLoading] = useState(true);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [proposalForm, setProposalForm] = useState<ProposalFormState>(defaultProposalForm);
  const [adviceForm, setAdviceForm] = useState<AdviceFormState>(defaultAdviceForm);
  const [decisionForms, setDecisionForms] = useState<Record<string, DecisionFormState>>({});
  const [proposalFormBusy, setProposalFormBusy] = useState(false);
  const [adviceFormBusy, setAdviceFormBusy] = useState(false);
  const [expandedProposalId, setExpandedProposalId] = useState<string | null>(null);
  const [eventsByProposalId, setEventsByProposalId] = useState<Record<string, GuildAiUpgradeEvent[]>>({});
  const [eventLoadingProposalId, setEventLoadingProposalId] = useState<string | null>(null);
  const [tokenUsageBusy, setTokenUsageBusy] = useState(false);
  const [creditTopupBusy, setCreditTopupBusy] = useState(false);
  const [revenueBusy, setRevenueBusy] = useState(false);
  const [pricingBusy, setPricingBusy] = useState(false);
  const [ollamaBootstrapBusy, setOllamaBootstrapBusy] = useState(false);
  const [runtimeSmokeBusy, setRuntimeSmokeBusy] = useState(false);
  const [taskSmokeBusy, setTaskSmokeBusy] = useState(false);
  const [taskSmokeRunBusy, setTaskSmokeRunBusy] = useState(false);
  const [taskArtifactBusy, setTaskArtifactBusy] = useState(false);
  const [taskLogBusy, setTaskLogBusy] = useState(false);
  const [taskRouteBusy, setTaskRouteBusy] = useState<GuildAiTaskRouteDecision | null>(null);
  const [runtimeSmokeResult, setRuntimeSmokeResult] = useState<GuildAiRuntimeSmokeResult | null>(null);
  const [taskSmokeResult, setTaskSmokeResult] = useState<GuildAiTaskSmokeResult | null>(null);
  const [taskSmokeRunResult, setTaskSmokeRunResult] = useState<GuildAiTaskSmokeRunResult | null>(null);
  const [taskRouteResult, setTaskRouteResult] = useState<GuildAiTaskRouteResult | null>(null);
  const [taskLogSnapshot, setTaskLogSnapshot] = useState<GuildAiTaskLogSnapshot | null>(null);
  const [taskArtifactSnapshot, setTaskArtifactSnapshot] = useState<GuildAiTaskArtifactSnapshot | null>(null);
  const [pricingForm, setPricingForm] = useState<PricingFormState>(defaultPricingForm);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (guildId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [
        health,
        templates,
        capability,
        upgrades,
        advice,
        accounts,
        accounting,
        journal,
        limitEvents,
        modelPricing,
        runtimeBindings,
        visualManifest,
        briefing,
      ] = await Promise.all([
        getGuildAiHealth(),
        listGuildAiTemplates(),
        getGuildAiCapabilities(guildId),
        listGuildAiUpgrades(guildId),
        listGuildAiAdvice(guildId),
        listGuildAiAccounts(guildId),
        getGuildAiAccounting(guildId),
        listGuildAiJournal(guildId),
        listGuildAiLimitEvents(guildId),
        listGuildAiModelPricing(guildId),
        listGuildAiRuntimeBindings(guildId),
        getGuildAiVisualManifest(guildId),
        getGuildAiBriefing(guildId),
      ]);
      setState({
        templates: templates.templates,
        capability: capability.capability,
        proposals: upgrades.proposals,
        advice: advice.advice,
        accounts: accounts.accounts,
        accountingSummary: accounting.summary,
        prepaidAiCreditBalance: accounting.prepaidAiCreditBalance,
        pnl: accounting.profitAndLoss,
        journal: journal.entries,
        limitEvents: limitEvents.events,
        modelPricing: modelPricing.pricing,
        runtimeBindings: runtimeBindings.bindings,
        visualManifest: visualManifest.manifest,
        briefing: briefing.briefing,
        pendingUpgrades: health.pendingUpgrades,
        vectorDbProvider: health.vectorDbProvider,
      });
      if (templates.templates.length > 0 && !templates.templates.some((template) => template.guild_id === guildId)) {
        setSelectedGuildId(templates.templates[0].guild_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(selectedGuildId);
  }, [load, selectedGuildId]);

  const groupedAccounts = useMemo(() => {
    return state.accounts.reduce<Record<string, GuildAiAccount[]>>((acc, account) => {
      acc[account.category] = [...(acc[account.category] ?? []), account];
      return acc;
    }, {});
  }, [state.accounts]);

  const decide = async (proposalId: string) => {
    const form = decisionForms[proposalId] ?? defaultDecisionForm;
    setBusyProposalId(proposalId);
    setError(null);
    try {
      await decideGuildAiUpgrade(proposalId, {
        decision: form.decision,
        decidedBy: form.decidedBy.trim() || "SGM",
        note: form.note.trim() || undefined,
      });
      setDecisionForms((prev) => {
        const next = { ...prev };
        delete next[proposalId];
        return next;
      });
      setEventsByProposalId((prev) => {
        const next = { ...prev };
        delete next[proposalId];
        return next;
      });
      await load(selectedGuildId);
      if (expandedProposalId === proposalId) {
        const result = await listGuildAiUpgradeEvents(proposalId);
        setEventsByProposalId((prev) => ({ ...prev, [proposalId]: result.events }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProposalId(null);
    }
  };

  const updateDecisionForm = (proposalId: string, patch: Partial<DecisionFormState>) => {
    setDecisionForms((prev) => ({
      ...prev,
      [proposalId]: {
        ...(prev[proposalId] ?? defaultDecisionForm),
        ...patch,
      },
    }));
  };

  const submitProposal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!proposalForm.title.trim() || !proposalForm.rationale.trim()) {
      setError("Proposal title and rationale are required.");
      return;
    }

    setProposalFormBusy(true);
    setError(null);
    try {
      await createGuildAiUpgradeProposal({
        guildId: selectedGuildId,
        proposedByAgentId: "pm-001",
        capabilityArea: proposalForm.capabilityArea,
        targetLevel: proposalForm.targetLevel,
        title: proposalForm.title,
        rationale: proposalForm.rationale,
        risk: { level: proposalForm.riskLevel },
        expectedBenefit: proposalForm.expectedBenefit ? { summary: proposalForm.expectedBenefit } : {},
        rollbackPlan: proposalForm.rollbackPlan,
      });
      setProposalForm(defaultProposalForm);
      await load(selectedGuildId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProposalFormBusy(false);
    }
  };

  const submitAdvice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!adviceForm.title.trim() || !adviceForm.recommendation.trim()) {
      setError("Advice title and recommendation are required.");
      return;
    }

    setAdviceFormBusy(true);
    setError(null);
    try {
      await createGuildAiAdvice({
        guildId: selectedGuildId,
        advisorAgentId: "pm-001",
        category: adviceForm.category,
        priority: adviceForm.priority,
        title: adviceForm.title,
        recommendation: adviceForm.recommendation,
        learningResources: adviceForm.learningResources
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
      setAdviceForm(defaultAdviceForm);
      await load(selectedGuildId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdviceFormBusy(false);
    }
  };

  const toggleEvents = async (proposalId: string) => {
    if (expandedProposalId === proposalId) {
      setExpandedProposalId(null);
      return;
    }

    setExpandedProposalId(proposalId);
    if (eventsByProposalId[proposalId]) return;

    setEventLoadingProposalId(proposalId);
    setError(null);
    try {
      const result = await listGuildAiUpgradeEvents(proposalId);
      setEventsByProposalId((prev) => ({ ...prev, [proposalId]: result.events }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEventLoadingProposalId(null);
    }
  };

  const recordSampleTokenSpend = async () => {
    setTokenUsageBusy(true);
    setError(null);
    try {
      await recordGuildAiTokenUsage({
        guildId: selectedGuildId,
        agentId: "worker-001",
        provider: "litellm",
        model: "local/gemma-4b",
        promptTokens: 1200,
        completionTokens: 360,
        costUsd: 0.42,
        paidFrom: "prepaid_ai_credits",
      });
      await load(selectedGuildId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTokenUsageBusy(false);
    }
  };

  const recordSampleCreditTopup = async () => {
    setCreditTopupBusy(true);
    setError(null);
    try {
      await recordGuildAiCreditTopup({
        guildId: selectedGuildId,
        provider: "openai",
        description: "AI provider credit top-up",
        amountUsd: 20,
        paidFrom: "cash",
        sourceType: "sample",
      });
      await load(selectedGuildId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreditTopupBusy(false);
    }
  };

  const recordSampleRevenue = async () => {
    setRevenueBusy(true);
    setError(null);
    try {
      await recordGuildAiRevenue({
        guildId: selectedGuildId,
        customerName: "Demo customer",
        description: "AI operations service revenue",
        amountUsd: 12.5,
        receivedTo: "cash",
        sourceType: "sample",
      });
      await load(selectedGuildId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevenueBusy(false);
    }
  };

  const submitPricing = async (event: FormEvent) => {
    event.preventDefault();
    setPricingBusy(true);
    setError(null);
    try {
      await upsertGuildAiModelPricing({
        guildId: selectedGuildId,
        provider: pricingForm.provider,
        model: pricingForm.model,
        promptUsdPerMillion: Number(pricingForm.promptUsdPerMillion),
        completionUsdPerMillion: Number(pricingForm.completionUsdPerMillion),
        source: "manual-ui",
      });
      await load(selectedGuildId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPricingBusy(false);
    }
  };

  const bootstrapOllamaRuntime = async () => {
    setOllamaBootstrapBusy(true);
    setError(null);
    try {
      const result = await bootstrapGuildAiOllamaRuntime(selectedGuildId, { assignRuntimeAgents: true });
      setState((prev) => ({ ...prev, runtimeBindings: result.bindings }));
      await load(selectedGuildId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOllamaBootstrapBusy(false);
    }
  };

  const runRuntimeSmoke = async () => {
    setRuntimeSmokeBusy(true);
    setError(null);
    try {
      const result = await runGuildAiRuntimeSmoke(selectedGuildId, {
        roleKey: "techLead",
        message: "Confirm Guild AI local runtime health in one compact JSON object.",
      });
      setRuntimeSmokeResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRuntimeSmokeBusy(false);
    }
  };

  const refreshTaskLogs = async (taskId = taskSmokeResult?.taskId) => {
    if (!taskId) return;
    setTaskLogBusy(true);
    setError(null);
    try {
      const snapshot = await getGuildAiTaskLogs(taskId);
      setTaskLogSnapshot(snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTaskLogBusy(false);
    }
  };

  const refreshTaskArtifacts = async (taskId = taskSmokeResult?.taskId) => {
    if (!taskId) return;
    setTaskArtifactBusy(true);
    setError(null);
    try {
      const snapshot = await getGuildAiTaskArtifacts(taskId, { guildId: selectedGuildId });
      setTaskArtifactSnapshot(snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTaskArtifactBusy(false);
    }
  };

  const stageTaskSmoke = async () => {
    setTaskSmokeBusy(true);
    setError(null);
    try {
      const result = await stageGuildAiTaskSmoke(selectedGuildId, { roleKey: "worker" });
      setTaskSmokeResult(result);
      setTaskSmokeRunResult(null);
      setTaskRouteResult(null);
      setTaskLogSnapshot(null);
      setTaskArtifactSnapshot(null);
      await refreshTaskLogs(result.taskId);
      await refreshTaskArtifacts(result.taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTaskSmokeBusy(false);
    }
  };

  const runTaskSmoke = async () => {
    if (!taskSmokeResult) return;
    setTaskSmokeRunBusy(true);
    setError(null);
    try {
      const result = await runGuildAiTaskSmoke(taskSmokeResult.taskId, { guildId: selectedGuildId });
      setTaskSmokeRunResult(result);
      await refreshTaskLogs(taskSmokeResult.taskId);
      await refreshTaskArtifacts(taskSmokeResult.taskId);
      await load(selectedGuildId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTaskSmokeRunBusy(false);
    }
  };

  const routeTaskSmoke = async (decision: GuildAiTaskRouteDecision) => {
    if (!taskSmokeResult) return;
    setTaskRouteBusy(decision);
    setError(null);
    try {
      const result = await routeGuildAiTask(taskSmokeResult.taskId, {
        guildId: selectedGuildId,
        decision,
        feedback:
          decision === "qa_fail"
            ? "Smoke QA requested one concise revision before approval."
            : decision === "techlead_escalate"
              ? "Smoke escalation requested PM guidance."
              : undefined,
        maxRetries: 1,
      });
      setTaskRouteResult(result);
      await refreshTaskLogs(taskSmokeResult.taskId);
      await refreshTaskArtifacts(taskSmokeResult.taskId);
      await load(selectedGuildId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTaskRouteBusy(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Guild AI Governance</div>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">Self-improvement control room</h2>
        </div>
        <select
          value={selectedGuildId}
          onChange={(event) => setSelectedGuildId(event.target.value)}
          className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950"
        >
          {state.templates.length === 0 ? (
            <option value={selectedGuildId}>{selectedGuildId}</option>
          ) : (
            state.templates.map((template) => (
              <option key={template.guild_id} value={template.guild_id}>
                {template.name}
              </option>
            ))
          )}
        </select>
      </div>

      {error && <div className="rounded-lg border border-rose-400/40 bg-rose-950/40 p-3 text-sm text-rose-100">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Capability level" value={state.capability?.current_level ?? 1} />
        <Metric label="Max approved" value={state.capability?.max_approved_level ?? 1} />
        <Metric label="Pending upgrades" value={state.pendingUpgrades} />
        <Metric label="Net income" value={`$${(state.pnl?.netIncome ?? 0).toFixed(2)}`} />
        <Metric label="Runtime ready" value={state.briefing?.metrics.runtimeAvailable ?? 0} />
        <Metric label="Runtime limited" value={state.briefing?.metrics.runtimeLimited ?? 0} />
      </div>

      {state.briefing && (
        <section className="rounded-lg border border-slate-700/70 bg-slate-950/70">
          <div className="flex flex-col gap-2 border-b border-slate-700/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold text-slate-100">SGM briefing</h3>
              <p className="mt-0.5 text-sm text-slate-300">{state.briefing.headline}</p>
            </div>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(state.briefing.status)}`}>
              {state.briefing.status}
            </span>
          </div>
          <div className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
            <div className="space-y-2">
              {state.briefing.bullets.map((bullet) => (
                <div key={bullet} className="rounded-md bg-slate-900/70 px-3 py-2 text-sm text-slate-200">
                  {bullet}
                </div>
              ))}
              <div className="grid gap-2 pt-2 md:grid-cols-2">
                {state.briefing.readiness.map((item) => (
                  <div key={item.key} className="rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{item.label}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(item.status)}`}>
                        {item.status}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-300">{item.detail}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              {state.briefing.nextActions.map((action) => (
                <div key={action.key} className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2">
                  <span className="text-sm text-slate-200">{action.label}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(action.priority === "high" ? "needs_info" : action.priority)}`}>
                    {action.priority}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {state.visualManifest && (
        <section className="rounded-lg border border-slate-700/70 bg-slate-950/70">
          <div className="flex flex-col gap-2 border-b border-slate-700/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold text-slate-100">Visual manifest</h3>
              <p className="mt-0.5 text-xs text-slate-400">Renderer-ready state for the future Guild office view</p>
            </div>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(state.visualManifest.scene.mood)}`}>
              {state.visualManifest.scene.mood}
            </span>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Actors</div>
              <div className="mt-1 text-xl font-semibold text-slate-100">{state.visualManifest.actors.length}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Accounting</div>
              <div className="mt-1 text-sm font-medium text-slate-100">{state.visualManifest.accounting.visualState}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Governance</div>
              <div className="mt-1 text-sm font-medium text-slate-100">{state.visualManifest.governance.visualState}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Tasks</div>
              <div className="mt-1 text-sm font-medium text-slate-100">{state.visualManifest.tasks.visualState}</div>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-lg border border-slate-700/70 bg-slate-950/70">
        <div className="flex flex-col gap-2 border-b border-slate-700/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-slate-100">AI limits</h3>
            <p className="mt-0.5 text-xs text-slate-400">Provider/model limits recorded for cost control and evaluation</p>
          </div>
          <button
            type="button"
            onClick={() => void load(selectedGuildId)}
            className="rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-slate-800"
          >
            Refresh
          </button>
        </div>
        <div className="grid gap-2 p-4">
          {state.limitEvents.length === 0 ? (
            <div className="text-sm text-slate-400">No model limits recorded.</div>
          ) : (
            state.limitEvents.slice(0, 5).map((event) => {
              const isActive = event.activeUntil ? event.activeUntil > Date.now() : false;
              const stateLabel = isActive ? "active" : event.recoveredAt ? "recovered" : "expired";
              return (
                <div key={event.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-100">
                        {event.provider} / {event.model}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">
                        {event.statusCode ? `HTTP ${event.statusCode}` : "provider"} / {formatDate(event.createdAt)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(isActive ? "needs_info" : "done")}`}>
                        {stateLabel}
                      </span>
                      <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
                        {event.limitType}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 max-h-10 overflow-hidden text-xs text-slate-400">{event.message}</div>
                  {event.activeUntil && (
                    <div className="mt-2 text-[11px] text-slate-500">until: {formatDate(event.activeUntil)}</div>
                  )}
                  {event.recoveredAt && (
                    <div className="mt-1 text-[11px] text-slate-500">recovered: {formatDate(event.recoveredAt)}</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-700/70 bg-slate-950/70">
        <div className="flex flex-col gap-2 border-b border-slate-700/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-slate-100">Local runtime</h3>
            <p className="mt-0.5 text-xs text-slate-400">Guild roles bound to runnable Claw agents and local models</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={ollamaBootstrapBusy}
              onClick={() => void bootstrapOllamaRuntime()}
              className="rounded-md border border-emerald-400/40 px-3 py-1.5 text-xs text-emerald-100 transition hover:bg-emerald-500/10 disabled:opacity-50"
            >
              Bootstrap Ollama runtime
            </button>
            <button
              type="button"
              disabled={runtimeSmokeBusy || state.runtimeBindings.length === 0}
              onClick={() => void runRuntimeSmoke()}
              className="rounded-md border border-sky-400/40 px-3 py-1.5 text-xs text-sky-100 transition hover:bg-sky-500/10 disabled:opacity-50"
            >
              Run smoke
            </button>
            <button
              type="button"
              disabled={taskSmokeBusy || state.runtimeBindings.length === 0}
              onClick={() => void stageTaskSmoke()}
              className="rounded-md border border-amber-400/40 px-3 py-1.5 text-xs text-amber-100 transition hover:bg-amber-500/10 disabled:opacity-50"
            >
              Stage task smoke
            </button>
          </div>
        </div>
        <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
          {state.runtimeBindings.length === 0 && (
            <div className="text-sm text-slate-400">No runtime bindings yet.</div>
          )}
          {state.runtimeBindings.map((binding) => {
            const availability = binding.availability_status ?? binding.status;
            const availabilityClass =
              availability === "available"
                ? statusClass("done")
                : availability === "limited"
                  ? statusClass("needs_info")
                  : statusClass(binding.status);
            return (
              <div key={binding.guild_agent_id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">{binding.guild_role_key}</div>
                    <div className="text-sm font-medium text-slate-100">{binding.guild_display_name}</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(binding.status)}`}>
                      {binding.status}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${availabilityClass}`}>
                      {availability}
                    </span>
                  </div>
                </div>
                <div className="mt-2 text-xs leading-5 text-slate-400">
                  <div>Runtime: {binding.runtime_agent_name}</div>
                  <div>Provider: {binding.api_provider_name}</div>
                  <div className="truncate font-mono text-slate-300">{binding.model}</div>
                  {binding.active_limit && (
                    <div className="mt-1 text-[11px] text-amber-200">
                      limited until {formatDate(binding.active_limit.activeUntil)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {runtimeSmokeResult && (
          <div className="border-t border-slate-800 p-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">{runtimeSmokeResult.roleKey}</div>
                  <div className="text-sm font-medium text-slate-100">{runtimeSmokeResult.runtimeAgentName}</div>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(runtimeSmokeResult.ok ? "completed" : "rejected")}`}
                >
                  {runtimeSmokeResult.ok ? "smoke ok" : "smoke failed"}
                </span>
              </div>
              <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-2 text-xs text-slate-200">
                {runtimeSmokeResult.output || runtimeSmokeResult.error || "No output"}
              </pre>
              <div className="mt-2 truncate font-mono text-[11px] text-slate-500">{runtimeSmokeResult.logPath}</div>
            </div>
          </div>
        )}
        {taskSmokeResult && (
          <div className="border-t border-slate-800 p-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">{taskSmokeResult.roleKey}</div>
                  <div className="text-sm font-medium text-slate-100">{taskSmokeResult.runtimeAgentName}</div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(taskSmokeResult.status)}`}>
                  {taskSmokeResult.status}
                </span>
              </div>
              <div className="mt-2 grid gap-1 font-mono text-[11px] text-slate-400">
                <div className="truncate">task: {taskSmokeResult.taskId}</div>
                <div className="truncate">project: {taskSmokeResult.projectId}</div>
                <div className="truncate">path: {taskSmokeResult.projectPath}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(["worker_done", "qa_fail", "qa_pass", "techlead_escalate"] as const).map((decision) => (
                  <button
                    key={decision}
                    type="button"
                    disabled={taskRouteBusy !== null}
                    onClick={() => void routeTaskSmoke(decision)}
                    className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {taskRouteBusy === decision ? "Routing..." : decision}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={taskSmokeRunBusy || taskRouteBusy !== null}
                  onClick={() => void runTaskSmoke()}
                  className="rounded-md border border-emerald-400/40 px-2.5 py-1 text-xs text-emerald-100 transition hover:bg-emerald-500/10 disabled:opacity-50"
                >
                  {taskSmokeRunBusy ? "Starting..." : "Run staged smoke"}
                </button>
                <button
                  type="button"
                  disabled={taskLogBusy}
                  onClick={() => void refreshTaskLogs()}
                  className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {taskLogBusy ? "Refreshing..." : "Refresh logs"}
                </button>
                <button
                  type="button"
                  disabled={taskArtifactBusy}
                  onClick={() => void refreshTaskArtifacts()}
                  className="rounded-md border border-sky-400/40 px-2.5 py-1 text-xs text-sky-100 transition hover:bg-sky-500/10 disabled:opacity-50"
                >
                  {taskArtifactBusy ? "Refreshing..." : "Refresh artifacts"}
                </button>
              </div>
              {taskRouteResult && (
                <div className="mt-3 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300">
                  {`${taskRouteResult.decision} -> ${taskRouteResult.status}`}
                  {taskRouteResult.assignedRole ? ` / ${taskRouteResult.assignedRole}` : ""}
                  {taskRouteResult.escalationLevel ? ` / escalate:${taskRouteResult.escalationLevel}` : ""}
                </div>
              )}
              {taskSmokeRunResult && (
                <div className="mt-3 rounded-md border border-emerald-400/20 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-100">
                  {`started -> ${taskSmokeRunResult.runtimeAgentName} / ${taskSmokeRunResult.roleKey}`}
                </div>
              )}
              {taskLogSnapshot && taskLogSnapshot.task.id === taskSmokeResult.taskId && (
                <div className="mt-3 rounded-md border border-slate-800 bg-slate-950">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-slate-200">{taskLogSnapshot.task.title}</div>
                      <div className="truncate text-[11px] text-slate-500">
                        {taskLogSnapshot.task.assignedAgentName ?? "unassigned"}
                        {taskLogSnapshot.task.projectPath ? ` / ${taskLogSnapshot.task.projectPath}` : ""}
                      </div>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(taskLogSnapshot.task.status)}`}>
                      {taskLogSnapshot.task.status}
                    </span>
                  </div>
                  <div className="max-h-40 overflow-auto px-3 py-2">
                    {taskLogSnapshot.logs.length === 0 ? (
                      <div className="text-xs text-slate-500">No task logs yet.</div>
                    ) : (
                      <div className="grid gap-2">
                        {taskLogSnapshot.logs.map((log) => (
                          <div key={log.id} className="grid gap-0.5 text-xs">
                            <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-slate-500">
                              <span>{log.kind}</span>
                              <span>{new Date(log.createdAt).toLocaleString()}</span>
                            </div>
                            <div className="text-slate-300">{log.message}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {taskArtifactSnapshot && taskArtifactSnapshot.taskId === taskSmokeResult.taskId && (
                <div className="mt-3 rounded-md border border-slate-800 bg-slate-950">
                  <div className="border-b border-slate-800 px-3 py-2">
                    <div className="text-xs font-medium text-slate-200">Scratch artifacts</div>
                    <div className="truncate font-mono text-[11px] text-slate-500">{taskArtifactSnapshot.projectPath}</div>
                  </div>
                  <div className="grid gap-2 p-3 md:grid-cols-2">
                    {taskArtifactSnapshot.artifacts.map((artifact) => (
                      <div key={artifact.name} className="min-w-0 rounded-md border border-slate-800 bg-slate-900/60">
                        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
                          <div className="font-mono text-xs text-slate-200">{artifact.name}</div>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] ${
                              artifact.exists ? statusClass("completed") : statusClass("needs_info")
                            }`}
                          >
                            {artifact.exists ? "found" : "missing"}
                          </span>
                        </div>
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap p-3 text-xs leading-5 text-slate-300">
                          {artifact.exists ? artifact.content : "Artifact has not been created yet."}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-lg border border-slate-700/70 bg-slate-950/70">
          <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-3">
            <h3 className="font-semibold text-slate-100">Upgrade proposals</h3>
            <button
              type="button"
              onClick={() => void load(selectedGuildId)}
              className="rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-slate-800"
            >
              Refresh
            </button>
          </div>
          <form onSubmit={submitProposal} className="grid gap-3 border-b border-slate-800 p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_120px_120px]">
              <TextInput
                label="Capability area"
                value={proposalForm.capabilityArea}
                onChange={(value) => setProposalForm((prev) => ({ ...prev, capabilityArea: value }))}
              />
              <label className="grid gap-1 text-xs text-slate-400">
                Target level
                <select
                  value={proposalForm.targetLevel}
                  onChange={(event) =>
                    setProposalForm((prev) => ({ ...prev, targetLevel: Number(event.target.value) }))
                  }
                  className="min-h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100"
                >
                  {[1, 2, 3, 4, 5].map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-slate-400">
                Risk
                <select
                  value={proposalForm.riskLevel}
                  onChange={(event) => setProposalForm((prev) => ({ ...prev, riskLevel: event.target.value }))}
                  className="min-h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100"
                >
                  {["low", "medium", "high"].map((risk) => (
                    <option key={risk} value={risk}>
                      {risk}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <TextInput
              label="Title"
              value={proposalForm.title}
              onChange={(value) => setProposalForm((prev) => ({ ...prev, title: value }))}
              placeholder="Enable weekly workflow self-review"
            />
            <TextArea
              label="Rationale"
              value={proposalForm.rationale}
              onChange={(value) => setProposalForm((prev) => ({ ...prev, rationale: value }))}
              placeholder="Why should the guild improve this capability?"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <TextArea
                label="Expected benefit"
                value={proposalForm.expectedBenefit}
                onChange={(value) => setProposalForm((prev) => ({ ...prev, expectedBenefit: value }))}
              />
              <TextArea
                label="Rollback plan"
                value={proposalForm.rollbackPlan}
                onChange={(value) => setProposalForm((prev) => ({ ...prev, rollbackPlan: value }))}
              />
            </div>
            <div>
              <button
                type="submit"
                disabled={proposalFormBusy}
                className="rounded-md border border-emerald-400/40 px-3 py-1.5 text-xs font-medium text-emerald-100 transition hover:bg-emerald-500/10 disabled:opacity-50"
              >
                Create proposal
              </button>
            </div>
          </form>
          <div className="divide-y divide-slate-800">
            {loading && <div className="p-4 text-sm text-slate-400">Loading...</div>}
            {!loading && state.proposals.length === 0 && (
              <div className="p-4 text-sm text-slate-400">No upgrade proposals yet.</div>
            )}
            {state.proposals.map((proposal) => {
              const risk = parseJsonObject(proposal.risk_json);
              const decisionForm = decisionForms[proposal.id] ?? defaultDecisionForm;
              return (
                <article key={proposal.id} className="p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-medium text-slate-100">{proposal.title}</h4>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(proposal.status)}`}>
                          {proposal.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-slate-300">{proposal.rationale}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                        <span>Area: {proposal.capability_area}</span>
                        <span>Target level: {proposal.target_level}</span>
                        <span>Risk: {String(risk.level ?? "not set")}</span>
                        <span>Created: {formatDate(proposal.created_at)}</span>
                        {proposal.decided_at && <span>Decided: {formatDate(proposal.decided_at)}</span>}
                      </div>
                      {proposal.human_decision_note && (
                        <div className="mt-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs leading-5 text-slate-300">
                          {proposal.decided_by ?? "SGM"}: {proposal.human_decision_note}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => void toggleEvents(proposal.id)}
                        className="mt-3 rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
                      >
                        {expandedProposalId === proposal.id ? "Hide history" : "Show history"}
                      </button>
                    </div>
                    {proposal.status === "pending" && (
                      <div className="grid gap-2 sm:w-64">
                        <div className="grid grid-cols-[1fr_92px] gap-2">
                          <label className="grid gap-1 text-xs text-slate-400">
                            Decision
                            <select
                              value={decisionForm.decision}
                              onChange={(event) =>
                                updateDecisionForm(proposal.id, { decision: event.target.value as UpgradeDecision })
                              }
                              className="min-h-9 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-100"
                            >
                              {(["sandbox", "approved", "needs_info", "rejected", "cancelled"] as const).map((decision) => (
                                <option key={decision} value={decision}>
                                  {decision}
                                </option>
                              ))}
                            </select>
                          </label>
                          <TextInput
                            label="By"
                            value={decisionForm.decidedBy}
                            onChange={(value) => updateDecisionForm(proposal.id, { decidedBy: value })}
                          />
                        </div>
                        <label className="grid gap-1 text-xs text-slate-400">
                          Decision note
                          <textarea
                            value={decisionForm.note}
                            onChange={(event) => updateDecisionForm(proposal.id, { note: event.target.value })}
                            placeholder="Reason, sandbox scope, or missing information"
                            rows={3}
                            className="resize-none rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs leading-5 text-slate-100 outline-none transition focus:border-emerald-400/60"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={busyProposalId === proposal.id}
                          onClick={() => void decide(proposal.id)}
                          className="rounded-md border border-emerald-400/40 px-2 py-1.5 text-xs font-medium text-emerald-100 transition hover:bg-emerald-500/10 disabled:opacity-50"
                        >
                          Save decision
                        </button>
                        <div className="grid grid-cols-2 gap-1">
                          {(["sandbox", "approved", "needs_info", "rejected"] as const).map((decision) => (
                            <button
                              key={decision}
                              type="button"
                              disabled={busyProposalId === proposal.id}
                              onClick={() => updateDecisionForm(proposal.id, { decision })}
                              className="rounded-md border border-slate-700 px-1 py-1 text-[11px] text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
                            >
                              {decision}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {proposal.status !== "pending" && proposal.decided_by && (
                      <div className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-400 sm:w-48">
                        Decided by <span className="text-slate-200">{proposal.decided_by}</span>
                      </div>
                    )}
                  </div>
                  {expandedProposalId === proposal.id && (
                    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                      {eventLoadingProposalId === proposal.id && <div className="text-xs text-slate-400">Loading history...</div>}
                      {(eventsByProposalId[proposal.id] ?? []).map((event) => (
                        <div key={event.id} className="grid gap-1 border-b border-slate-800 py-2 last:border-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-slate-200">{event.event_type}</span>
                            <span className="text-[11px] text-slate-500">{formatDate(event.created_at)}</span>
                          </div>
                          {event.note && <div className="text-xs leading-5 text-slate-400">{event.note}</div>}
                        </div>
                      ))}
                      {!eventLoadingProposalId && (eventsByProposalId[proposal.id] ?? []).length === 0 && (
                        <div className="text-xs text-slate-400">No events recorded.</div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-slate-700/70 bg-slate-950/70">
          <div className="border-b border-slate-700/70 px-4 py-3">
            <h3 className="font-semibold text-slate-100">SGM Advisor</h3>
          </div>
          <form onSubmit={submitAdvice} className="grid gap-3 border-b border-slate-800 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs text-slate-400">
                Category
                <select
                  value={adviceForm.category}
                  onChange={(event) =>
                    setAdviceForm((prev) => ({ ...prev, category: event.target.value as AdviceFormState["category"] }))
                  }
                  className="min-h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100"
                >
                  {["learning", "delegation", "finance", "strategy", "operations", "risk"].map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-slate-400">
                Priority
                <select
                  value={adviceForm.priority}
                  onChange={(event) =>
                    setAdviceForm((prev) => ({ ...prev, priority: event.target.value as AdviceFormState["priority"] }))
                  }
                  className="min-h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100"
                >
                  {["low", "medium", "high", "urgent"].map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <TextInput
              label="Title"
              value={adviceForm.title}
              onChange={(value) => setAdviceForm((prev) => ({ ...prev, title: value }))}
              placeholder="เรียนรู้การอ่าน P&L รายสัปดาห์"
            />
            <TextArea
              label="Recommendation"
              value={adviceForm.recommendation}
              onChange={(value) => setAdviceForm((prev) => ({ ...prev, recommendation: value }))}
              placeholder="What should the human owner learn or change?"
            />
            <TextArea
              label="Learning resources, one per line"
              value={adviceForm.learningResources}
              onChange={(value) => setAdviceForm((prev) => ({ ...prev, learningResources: value }))}
            />
            <div>
              <button
                type="submit"
                disabled={adviceFormBusy}
                className="rounded-md border border-sky-400/40 px-3 py-1.5 text-xs font-medium text-sky-100 transition hover:bg-sky-500/10 disabled:opacity-50"
              >
                Add advice
              </button>
            </div>
          </form>
          <div className="divide-y divide-slate-800">
            {state.advice.length === 0 && <div className="p-4 text-sm text-slate-400">No advice yet.</div>}
            {state.advice.slice(0, 6).map((item) => (
              <article key={item.id} className="p-4">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(item.status)}`}>
                    {item.priority}
                  </span>
                  <span className="text-xs text-slate-400">{item.category}</span>
                </div>
                <h4 className="mt-2 font-medium text-slate-100">{item.title}</h4>
                <p className="mt-1 text-sm leading-6 text-slate-300">{item.recommendation}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-slate-700/70 bg-slate-950/70">
        <div className="flex flex-col gap-2 border-b border-slate-700/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-slate-100">Thai accounting chart</h3>
            <p className="mt-0.5 text-xs text-slate-400">Revenue, expenses, and token spend journal entries</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={creditTopupBusy}
              onClick={() => void recordSampleCreditTopup()}
              className="rounded-md border border-amber-400/40 px-3 py-1.5 text-xs text-amber-100 transition hover:bg-amber-500/10 disabled:opacity-50"
            >
              Record sample AI credits
            </button>
            <button
              type="button"
              disabled={revenueBusy}
              onClick={() => void recordSampleRevenue()}
              className="rounded-md border border-sky-400/40 px-3 py-1.5 text-xs text-sky-100 transition hover:bg-sky-500/10 disabled:opacity-50"
            >
              Record sample revenue
            </button>
            <button
              type="button"
              disabled={tokenUsageBusy}
              onClick={() => void recordSampleTokenSpend()}
              className="rounded-md border border-emerald-400/40 px-3 py-1.5 text-xs text-emerald-100 transition hover:bg-emerald-500/10 disabled:opacity-50"
            >
              Record sample token spend
            </button>
          </div>
        </div>
        <div className="grid gap-3 border-b border-slate-800 p-4 sm:grid-cols-4">
          <Metric label="Revenue" value={`$${(state.pnl?.revenue ?? 0).toFixed(2)}`} />
          <Metric label="Expenses" value={`$${(state.pnl?.expenses ?? 0).toFixed(2)}`} />
          <Metric label="P&L" value={`$${(state.pnl?.netIncome ?? 0).toFixed(2)}`} />
          <Metric label="Prepaid AI credits" value={`$${state.prepaidAiCreditBalance.toFixed(2)}`} />
        </div>
        <form onSubmit={submitPricing} className="grid gap-3 border-b border-slate-800 p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_140px_140px_auto] md:items-end">
            <TextInput
              label="Provider"
              value={pricingForm.provider}
              onChange={(value) => setPricingForm((prev) => ({ ...prev, provider: value }))}
              placeholder="openai"
            />
            <TextInput
              label="Model"
              value={pricingForm.model}
              onChange={(value) => setPricingForm((prev) => ({ ...prev, model: value }))}
              placeholder="gpt-4o-mini"
            />
            <label className="grid gap-1 text-xs text-slate-400">
              Prompt / 1M
              <input
                type="number"
                min="0"
                step="0.0001"
                value={pricingForm.promptUsdPerMillion}
                onChange={(event) => setPricingForm((prev) => ({ ...prev, promptUsdPerMillion: event.target.value }))}
                className="min-h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60"
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              Completion / 1M
              <input
                type="number"
                min="0"
                step="0.0001"
                value={pricingForm.completionUsdPerMillion}
                onChange={(event) =>
                  setPricingForm((prev) => ({ ...prev, completionUsdPerMillion: event.target.value }))
                }
                className="min-h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60"
              />
            </label>
            <button
              type="submit"
              disabled={pricingBusy}
              className="min-h-9 rounded-md border border-amber-400/40 px-3 text-xs text-amber-100 transition hover:bg-amber-500/10 disabled:opacity-50"
            >
              Save pricing
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {state.modelPricing.length === 0 && <span className="text-xs text-slate-500">No model pricing configured.</span>}
            {state.modelPricing.map((item) => (
              <span
                key={`${item.provider}-${item.model}`}
                className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-300"
              >
                {item.provider}/{item.model}: ${item.prompt_usd_per_million}/${
                  item.completion_usd_per_million
                } per 1M
              </span>
            ))}
          </div>
        </form>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
          {(["asset", "liability", "equity", "revenue", "expense"] as const).map((category) => (
            <div key={category} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{category}</div>
              <div className="mt-2 space-y-2">
                {(groupedAccounts[category] ?? []).map((account) => (
                  <div key={account.account_code} className="rounded-md bg-slate-950/70 p-2">
                    <div className="text-xs text-slate-400">{account.account_code}</div>
                    <div className="text-sm font-medium text-slate-100">{account.account_name_th}</div>
                    <div className="text-xs text-slate-500">{account.normal_balance}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-800 p-4">
          <h4 className="text-sm font-semibold text-slate-100">Latest journal entries</h4>
          <div className="mt-3 space-y-3">
            {state.journal.length === 0 && <div className="text-sm text-slate-400">No journal entries yet.</div>}
            {state.journal.slice(0, 5).map((entry) => (
              <article key={entry.id} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="font-medium text-slate-100">{entry.description}</div>
                  <div className="text-xs text-slate-400">{entry.entry_date}</div>
                </div>
                <div className="mt-2 grid gap-2">
                  {entry.lines.map((line) => (
                    <div key={`${entry.id}-${line.account_code}-${line.debit}-${line.credit}`} className="grid grid-cols-[72px_1fr_80px_80px] gap-2 text-xs">
                      <span className="text-slate-400">{line.account_code}</span>
                      <span className="text-slate-200">{line.account_name_th}</span>
                      <span className="text-right text-emerald-200">{line.debit ? line.debit.toFixed(2) : "-"}</span>
                      <span className="text-right text-amber-200">{line.credit ? line.credit.toFixed(2) : "-"}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </section>
  );
}
