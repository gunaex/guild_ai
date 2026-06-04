# Guild AI Roadmap

## Speed Lane Guardrail

Acceleration rule: move the local-first MVP faster without deleting the full product vision.

Protected long-term features:

- Dual visual layer and long-running dashboards.
- SGM Advisor recommendations to the human owner.
- HR governance and replacement workflows.
- Thai accounting audit trail.
- L2/L3 memory path.
- Local-first, LAN-ready, internet-hardened deployment.

See `docs/SPEED_LANE.md` before taking shortcuts.

## Phase 0 - Foundation

Status: mostly complete.

- Monorepo scaffold.
- Environment templates.
- Docker Compose for core, Redis, and Chroma.
- LLM response hardening.
- UI state bridge.
- Public GitHub fork snapshot at `https://github.com/gunaex/guild_ai.git`.
- Embedded upstream OAuth app credentials removed; OAuth integrations now require env-supplied app credentials.

## Phase 1 - Guild Schema And Accounting

Status: active, mostly implemented in the Claw-Empire fork.

- Universal guild template loader.
- Required role enforcement.
- Token ledger skeleton.
- Thai-style accounting foundation using 5 account categories.
- SQLite-backed template import/list/detail routes.
- Thai chart of accounts.
- Double-entry journal entries for token usage and service revenue.
- P&L summary.
- Guild AI panel accounting metrics and latest journal entries.
- Model pricing configuration and automatic token cost estimation.
- Prepaid AI credit top-up journal entries and prepaid credit balance tracking.
- API-provider token usage payment selection from prepaid credits with accounts-payable fallback.

Remaining:

- Expand journal sources beyond token usage, prepaid credit top-ups, and manual service revenue.
- Connect real sales/service income events.

## Phase 1.5 - Self-Improving Company Governance

Status: active, usable foundation.

- Capability levels per guild.
- AI-generated upgrade proposals.
- Human approval before upgrades are applied.
- Upgrade history and outcome records.
- Sandbox/experiment mode before production rollout.
- Executive Coach / SGM Advisor recommendations for the human owner.
- Upgrade decision UI.
- Event history per proposal.
- Runtime smoke path for local Guild agents.
- SGM briefing from live runtime, accounting, governance, and task data.

Guardrail:

AI can propose upgrades, experiments, and learning advice. Humans approve level upgrades and production-impacting changes.

## Phase 2 - Queue Engine And Local Deployment

Status: local-first MVP accepted; deployment readiness gates are active.

Prerequisite:

- Fork or clone `GreenSheep01201/claw-empire`.
- Port Guild AI modules into the existing upstream architecture.
- Bind Guild roles to runnable Claw agents.
- Verify read-only runtime smoke through Local Ollama.
- Stage safe scratch tasks for Guild runtime agents without touching production repositories.
- Apply Guild-aware route decisions for Worker -> QA -> Worker retry -> Tech Lead -> PM.

Bootstrap helper now exists:

```bash
bash scripts/bootstrap-claw-fork.sh ../guild-ai-claw-fork
```

- Run a staged safe scratch task smoke and inspect task logs/artifacts.
- Guild worker success now routes to QA through the real run-completion lifecycle.
- QA pass/fail review outcomes now route through Guild decisions.
- Guild AI panel can exercise staged task route decisions for smoke validation.
- Guild AI panel can inspect staged task status, assigned agent, and latest task logs after route decisions.
- Guild AI panel can now start a staged scratch smoke task through a guarded smoke-run endpoint that rejects non-smoke tasks and non-temp project paths.
- Scratch smoke projects now include a local `GUILD_SMOKE.md` brief and `SMOKE_RESULT.md` output target so the first real runtime run has concrete work to do.
- AI provider/model limit events are recorded, active limited models are paused before repeat calls, and other provider/model choices can continue.
- Expired AI provider/model cooldowns are marked recovered and automatically become callable again.
- Active limited provider/model pairs can fall back to an available same-role runtime binding before failing the task.
- Runtime binding cards show available/limited/disabled status before runs start.
- SGM briefing summarizes runtime readiness and blocked roles before execution.
- Runtime smoke, task smoke, and Guild route decisions prefer available bindings over known-limited bindings.
- Real task execution preflights Guild runtime availability before marking a task in progress or creating a worktree; limited assigned runtimes switch to an available same-role runtime, and fully blocked roles stay pending.
- Guild AI panel shows recent AI limit events for cost control and model evaluation.
- Run and inspect a real scratch task through Worker -> QA under Guild governance.
- Local MVP acceptance command: `npm run guild:mvp-check`.
- Latest local acceptance passed 10/10 gates against the running fork server.
- `qa_pass` for Guild smoke tasks is gated on completed `SMOKE_RESULT.md` evidence.
- Escalate repeated failure to Tech Lead and PM with accounting/governance evidence.
- Deployment readiness API and panel gate local/LAN/internet exposure before operators bind services outside loopback.

## Phase 3 - HR Governance

Status: active foundation.

- Daily productivity scoring.
- Productivity reviews and below-floor termination governance requests.
- Human approval controls for termination/replacement requests.
- Replacement agent persona generation.
- Link HR evidence into governance requests and upgrade decisions.

## Phase 4 - External Tools And Memory

Status: active; SQLite L2 memory is implemented, Chroma L3 remains optional.

- Webhook gateway for n8n/Make.
- SQLite L2 memory records for durable operating facts, advice, decisions, and accounting context.
- ChromaDB guild memory adapter.
- Affine/AnythingLLM adapters.

## Phase 5 - Dual Visual Layer

Status: contract started.

- Renderer-ready visual manifest API.
- Guild AI panel visual manifest preview.
- Phaser cartoon renderer subscribed to the bridge.
- Technical log and latency dashboards.
- Shadow PM writing `project-brain/CONTEXT.md`.
