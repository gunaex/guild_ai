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

Protected production-grade capabilities:

- ChromaDB L3 RAG retrieval adapter with SQLite fallback.
- Real daily productivity scoring from task, QA, rework, cost, and limit evidence.
- Multi-guild templates beyond `ecom-001`.
- Phaser pixel UI subscribed to the visual bridge snapshot.
- Provider limit brain with cooldown ETA, fallback score, and cost/reliability history.
- Execution timeline and audit replay for each task.

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

## Phase 2.5 - New Local AI Server Migration

Status: planned for next week.

Goal:

Move Guild AI from the current notebook/workstation runtime to a dedicated local AI server while preserving local-first operation, LAN access, SQLite data, Ollama/runtime bindings, backups, and BCT evidence.

Migration plan:

1. Prepare the new server
   - Install Node.js 22+.
   - Install `npm`/`pnpm` as available.
   - Install Git.
   - Install Ollama.
   - Pull required local models.
   - Confirm GPU/CPU availability and disk capacity.

2. Clone and configure Guild AI
   - Clone `https://github.com/gunaex/guild_ai.git`.
   - Install dependencies.
   - Copy `.env` values without committing secrets.
   - Set a strong `API_AUTH_TOKEN`.
   - Configure `GUILD_AI_BACKUP_DIR`.
   - Keep `HOST=127.0.0.1` for first local verification.

3. Move operating data safely
   - Run manual backup on the current machine.
   - Verify restore proof before trusting the backup.
   - Copy SQLite DB, WAL/SHM sidecars when needed, logs, and backup manifests.
   - Start the new server against copied data.
   - Confirm `guild_backup_snapshots` and latest restore proof are visible.

4. Rebind local runtime
   - Start Ollama on the new server.
   - Confirm `http://127.0.0.1:11434/v1/models` returns local models.
   - Run Ollama bootstrap from Guild AI.
   - Verify runtime bindings for `pm`, `techLead`, `worker`, `qa`, `hr`, and `accounting`.
   - Run read-only runtime smoke.
   - Run staged Worker smoke with `SMOKE_RESULT.md` evidence.

5. Enable LAN access only after local acceptance
   - Run `npm run guild:bct`.
   - Run `npm run guild:mvp-check`.
   - Run `npm run guild:doctor`.
   - Bind UI/API to LAN only after the above passes.
   - Use firewall rules to allow only trusted LAN clients.
   - Do not expose the dev server to the internet.

6. Autostart and operations
   - Add systemd user service only after acceptance passes.
   - Confirm daily PM report scheduler.
   - Confirm automatic daily backup and 14-day retention.
   - Confirm Daily PM report includes backup/restore status.
   - Document the new server LAN URL and recovery command.

Acceptance gates before cutover:

- `npm run build` passes.
- `npm run test:api` passes.
- `npm run guild:bct` passes 16/16 stages.
- `npm run guild:mvp-check` passes 10/10 gates.
- `npm run guild:doctor` has no `FAIL`.
- Guild AI panel opens from the server itself.
- LAN client can open the UI through the approved LAN URL.
- Ollama local runtime smoke passes or is explicitly documented as skipped.
- Latest backup snapshot has verified restore proof.
- Rollback path is documented: return to current machine using the last verified backup.

## Phase 3 - HR Governance

Status: production-grade foundation active; Daily PM reports and real scoring are scheduled/available.

- Daily PM report scheduler at 08:00 Asia/Bangkok.
- Manual Daily PM report generation from the Guild AI panel/API.
- Daily productivity scoring from task, QA, rework, cost, and model-limit evidence.
- Productivity reviews and below-floor termination governance requests.
- Human approval controls for termination/replacement requests.
- Replacement agent persona generation.
- Link HR evidence into governance requests and upgrade decisions.

## Phase 4 - External Tools And Memory

Status: active; SQLite L2 memory is implemented, Chroma L3 adapter/status/RAG fallback is available and optional.

- Webhook gateway for n8n/Make.
- SQLite L2 memory records for durable operating facts, advice, decisions, and accounting context.
- ChromaDB guild memory adapter status plus RAG fallback endpoint.
- Affine/AnythingLLM adapters.

## Phase 5 - Dual Visual Layer

Status: renderer bridge ready.

- Renderer-ready visual manifest API.
- Guild AI panel visual manifest preview.
- Phaser cartoon renderer can subscribe through the visual bridge snapshot.
- Technical log and latency dashboards.
- Shadow PM writing `project-brain/CONTEXT.md`.
