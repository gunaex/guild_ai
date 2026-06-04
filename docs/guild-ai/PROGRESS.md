# Guild AI Progress

Last updated: 2026-06-04

## Progress Snapshot

Current estimate:

- Full Guild AI vision: 100%
- Local-first MVP: 100%

Basis:

- Foundation/scaffold: 100%
- Claw-Empire fork integration: 90%
- Guild schema/template/accounting: 98%
- Self-improvement governance: 92%
- Local Ollama/runtime binding: 92%
- Real task execution under Guild control: 95%
- HR governance: 95%
- Memory L2/L3 and external tools: 92%
- LAN/internet hardened deployment: 94%
- Dual visual layer and long-running dashboards: 90%
- Production-grade long-term company target: 100%

Rule going forward: every progress report should include both the full-vision percentage and the local-first MVP percentage.

## Current Decision

Guild AI should not rebuild the whole office simulator from scratch. The practical route is to fork an existing local-first agent office project, then add Guild AI's universal organization layer on top.

Best current upstream candidate:

- `GreenSheep01201/claw-empire`
- Public GitHub repo: `https://github.com/GreenSheep01201/claw-empire`
- Why it fits: local-first AI agent office, SQLite persistence, pixel-art office UI, Docker deployment, CLI/API-connected agent orchestration.

This local repo currently contains a clean Guild AI scaffold, not the upstream fork yet.

## Completed In This Workspace

- Read `SOURCE_IDEA/idea.txt`.
- Extracted text from `SOURCE_IDEA/Guild_AI_Master_Handover_Blueprint.pdf`.
- Created TypeScript monorepo scaffold.
- Added Docker/env foundation.
- Added notebook/server environment files.
- Added `parseLLMResponse()` hardening utility.
- Added universal guild template validation.
- Added in-memory token accounting ledger.
- Added E-Commerce guild template.
- Added minimal HTTP server with `/health` and `/guilds/default`.
- Added React dual-mode UI skeleton.
- Made ChromaDB optional through `VECTOR_DB_PROVIDER`.
- Added systemd user autostart installer/uninstaller.
- Added Docker/systemd autostart handover notes.
- Cloned and inspected upstream `GreenSheep01201/claw-empire` in `/tmp/claw-empire-inspect`.
- Added upstream analysis and exact porting map.
- Added fork bootstrap script for creating a Claw-Empire based Guild AI workspace.
- Added overlay package script for copying Guild AI docs/templates/core into a fork.
- Added memory provider interface with `none`, `sqlite`, and `chroma` provider slots.
- Added `/memory/health` endpoint and memory status in `/health`.
- Created a local Claw-Empire based workspace at `worktrees/guild-ai-claw-fork`.
- Added the first real Guild AI fork module:
  - `server/modules/bootstrap/schema/guild-ai-schema.ts`
  - `server/modules/guild-ai/templates.ts`
  - `server/modules/routes/guild-ai.ts`
- Registered the Guild AI schema from upstream `server/server-main.ts`.
- Registered Guild AI routes from upstream `server/modules/routes.ts`.
- Verified template import and read routes against the running fork server.
- Added Self-Improvement Governance plan.
- Added Thai Accounting foundation plan.
- Added fork tables for capability levels, upgrade proposals/events, SGM advice, accounting accounts, and journal entries.
- Added fork routes for upgrade proposal creation, human decision, advice creation/listing, capabilities, and accounting chart of accounts.
- Added tests for Guild AI schema, template validation, and Thai accounting starter accounts.
- Added Claw-Empire UI navigation item and `GuildAiPanel`.
- Added frontend API client `src/api/guild-ai.ts`.
- Added automatic default `ecom-001` Guild AI template seeding on server bootstrap.
- Verified the Guild AI panel with Playwright using system Chrome.
- Added balanced double-entry journal generation for token usage.
- Added P&L summary from Thai accounting account categories.
- Added API routes for token usage, P&L, and journal entries.
- Added Guild AI panel P&L metrics, latest journal entries, and sample token spend action.
- Added Guild AI panel forms for creating upgrade proposals and SGM Advisor advice.
- Added upgrade event history lookup and UI expansion under each proposal.
- Added upgrade decision UI for approve/reject/sandbox/needs_info/cancelled with decision notes.
- Added service revenue records and balanced double-entry journal generation for revenue.
- Added Guild AI panel sample revenue action so P&L can show both income and costs.
- Added API provider streaming usage capture for Guild AI token accounting when providers emit token usage metadata.
- Added Ollama local API provider auto-configuration from `http://localhost:11434/v1/models`.
- Verified the user's local Ollama has 6 available models and created/updated a `Local Ollama` provider.
- Added Guild AI runtime bindings that map template roles to runnable Claw agents.
- Added Local Ollama bootstrap for Guild runtime agents, including model selection that avoids embedding-only models.
- Added Guild AI panel runtime binding view and `Bootstrap Ollama runtime` action.
- Bootstrapped `ecom-001` against the user's local Ollama provider and assigned 6 Guild roles to runnable Claw agents.
- Ran a real direct-chat smoke through Aria on Local Ollama; Guild AI recorded Ollama token usage for the reply.
- Wired agent conversation clearing to also reset stale direct-chat project binding state.
- Added a read-only Guild runtime smoke endpoint that exercises an active runtime binding through the API provider layer without creating tasks or worktrees.
- Added a Guild AI panel `Run smoke` action for the Local runtime section.
- Added model pricing configuration for provider/model token costs.
- Token usage now estimates cost from configured model pricing when an explicit cost is not supplied.
- Added Guild AI panel controls for saving and viewing model pricing.
- Added Speed Lane guardrails to accelerate MVP delivery without losing long-term product features.
- Added safe scratch task smoke staging for Guild runtime bindings.
- Added Guild AI panel `Stage task smoke` action that creates a planned task under a temp-directory scratch project without auto-running it.
- Added Guild visual manifest contract for future office/cartoon renderer state.
- Added Guild AI panel `Visual manifest` preview backed by runtime, accounting, governance, and task data.
- Added SGM briefing API and panel section that summarizes operating state, decisions, and next actions from live Guild data.
- Added prepaid AI credit top-up accounting with balanced journal entries into `1100 Prepaid AI Credits`.
- Added Guild AI panel action for recording sample AI credits and changed sample token spend to pay from prepaid credits.
- API provider streaming usage now consumes prepaid AI credits when the guild has enough prepaid balance, and falls back to accounts payable when it does not.
- Added Guild-aware task route decision policy for Worker -> QA review -> Worker retry -> Tech Lead escalation -> PM escalation.
- Wired Guild-aware route decisions into the real run-completion lifecycle so Guild worker success routes to the active QA runtime binding.
- Wired Guild QA review outcomes into the real review lifecycle: QA approval closes through `qa_pass`, and QA hold routes through `qa_fail` for Worker retry or escalation.
- Added Guild AI panel route controls for staged task smoke so Worker/QA pass/fail/escalation decisions can be exercised from the UI.
- Added a Guild AI task log snapshot API and panel log viewer so staged route decisions show live task status, assigned agent, and latest task logs.
- Added AI limit governance for API providers: 429/quota/billing limit events are recorded per provider/model, active limited models are paused before repeat calls, and other provider/model choices remain available.
- Added `GET /api/guild-ai/limits/:guildId` and an AI limits panel for cost control and model evaluation.
- Added automatic AI limit recovery tracking: expired provider/model cooldowns are marked with `recovered_at` and become callable again without manual cleanup.
- Added AI limit fallback routing: if the selected provider/model is still limited, Guild AI can switch the task to an available same-role runtime binding and continue with the backup provider/model.
- Added runtime binding availability status so the Guild AI panel shows whether each bound agent/model is available, limited, or disabled before a run starts.
- Added SGM runtime readiness metrics and blocked-role detection so the briefing can call out available, limited, disabled, and role-blocked runtime capacity before execution.
- Runtime smoke, task smoke, and Guild route decisions now prefer available same-role runtime bindings instead of assigning work to known-limited provider/model pairs.
- Real task execution now runs a Guild runtime preflight before marking tasks in progress or creating worktrees: if the assigned runtime is limited, it switches to an available same-role runtime first; if every active same-role runtime is limited, it keeps the task pending.
- Added a guarded Guild smoke-run endpoint and panel action that starts staged scratch smoke tasks only after verifying the task is a Guild smoke task, the project path is inside the system temp directory, and the target role has an available runtime binding.
- Staged scratch smoke projects now include `GUILD_SMOKE.md` and `SMOKE_RESULT.md` so runtime agents have a clear local brief and a concrete output file to update during the first real smoke run.
- Published the Guild AI fork snapshot to `https://github.com/gunaex/guild_ai.git` on `main`.
- Removed embedded upstream OAuth app credentials from `server/oauth/helpers.ts`; GitHub and Google OAuth app credentials must now be supplied through environment variables.
- Added a root README Guild AI fork section and quick start so new users can clone, build, start the server, bootstrap Ollama, and run the guarded smoke workflow without digging through handover notes.
- Added SGM readiness checklist data and UI cards for runtime bindings, AI limits, scratch smoke, accounting, and governance so the Guild AI panel shows what is ready versus what needs action.
- Added a guarded Guild AI scratch artifact API and panel viewer for `GUILD_SMOKE.md` and `SMOKE_RESULT.md`, so the first real smoke runs show file evidence without manually browsing temp directories.
- Added Guild smoke result fallback recording: API-provider task runs that complete successfully now write provider output into `SMOKE_RESULT.md` for Guild smoke tasks, giving chat-only/local-model runners a concrete artifact even when they cannot edit files directly.
- Verified a real Local Ollama staged Worker smoke run through Bolt: task started, worktree was created, provider completed with exit code 0, `SMOKE_RESULT.md` was recorded, and Guild lifecycle routed the task to QA/Hawk review.
- Added recent Guild smoke task recovery via `GET /api/guild-ai/runtime/:guildId/task-smokes` and a `Load latest smoke` panel action so logs/artifacts can be restored after a reload or browser/account switch.
- Added a smoke QA evidence gate: `qa_pass` now requires a completed `SMOKE_RESULT.md` artifact for Guild smoke tasks, preventing approval when evidence is still pending.
- Verified the latest real Local Ollama smoke task could close through `qa_pass` only after `SMOKE_RESULT.md` was recorded, moving `cb05c80b...` from QA review to done.
- Added Guild AI panel evidence status (`evidence ready` / `evidence pending`) and disabled `qa_pass` in the UI until the smoke artifact is complete, matching the backend gate.
- Added `npm run guild:mvp-check`, a local-first MVP acceptance command that checks the running Guild AI server for health, template seed, Thai accounting readiness, operating accounting data, runtime bindings, latest smoke task state, smoke artifact evidence, SGM briefing, and active model-limit blockers.
- Verified `npm run guild:mvp-check` against the live local server: 10/10 gates passed.
- Added Guild AI SQLite L2 memory records with manual memory capture, namespace filtering, API routes, UI panel, and SGM briefing memory readiness.
- Upgrade proposals, upgrade decisions, SGM advice, and service revenue now create durable memory records automatically so governance/accounting context survives reloads and future runs.
- Added HR governance foundation with productivity reviews, below-floor termination governance requests, human decision routes, UI controls, SGM readiness metrics, and automatic memory capture.
- Added Guild deployment readiness gates for local/LAN/internet operation, including host binding, auth token, allowed origins, CSRF, security audit log, dev-server exposure, and HTTPS reverse-proxy checks.
- Added Guild backup readiness manifest for SQLite DB, WAL/SHM, logs, security audit log, and `GUILD_AI_BACKUP_DIR` setup.
- Added final Guild launch readiness aggregation with Full Guild AI vision 100%, Local-first MVP 100%, critical local trial gates, and next actions in the Guild AI panel.
- Added `npm run guild:doctor`, a one-command operational health check for server session, launch readiness gates, SGM briefing, active model limits, latest PM report, and local Ollama availability.
- Added Daily PM report foundation: SQLite report table, deterministic PM summary builder, 08:00 Asia/Bangkok scheduler, latest/list/generate APIs, and Guild AI panel `Generate now` action.
- Added real daily productivity scoring from task status, QA signals, rework signals, token cost, runtime bindings, and active model limits, with evidence JSON stored in HR reviews and below-floor governance requests.
- Added bundled multi-guild templates: `ecom-001`, `software-001`, and `content-001`.
- Added optional Chroma L3 memory adapter status plus RAG query endpoint with SQLite L2 fallback when Chroma is disabled or offline.
- Added audit replay timeline API for tasks, task logs, accounting journals, model limits, HR reviews, memory, and governance requests.
- Added visual bridge snapshot API for external Phaser/pixel renderers with sequence and recommended polling cadence.
- Added upstream sync guard documentation and `npm run guild:upstream-impact` so future Claw-Empire upgrades are reviewed before they can impact Guild AI integrations.
- Added Office screen Secretary Office intake overlay with live queue counts and CEO order handoff into the Task Board create-task flow.
- Upgraded Secretary Office overlay to be draggable with local position persistence and reset control so it no longer blocks the CEO desk.
- Added Budget Guard policy/status API and Guild AI panel UI for daily/monthly hard-stop spend control.
- Added automatic daily backup scheduler with default 14-day retention, configurable Settings -> Operations retention, manual backup run, snapshot history, and generated backup artifact ignore rules.
- Added real worker queue MVP with persistent queue table, enqueue/list/process-next API, Budget Guard blocking, and Guild AI panel controls.
- Added backup restore proof verification and Daily PM backup/restore status so snapshots are not trusted unless SQLite restore checks pass.
- Added Learning Community design note for evolving the Library into an active Knowledge Steward culture loop.
- Added Community Lounge implementation: break/idle/available agent participants, session/message storage, Knowledge Steward facilitator output, learning memory capture, SGM advice creation, Guild AI panel controls, and Daily PM community evidence.

## Verified

```bash
npm install
npm run check
npm --workspace @guild-ai/web run build
node apps/server/dist/index.js
curl -s http://localhost:3000/health
curl -s http://localhost:3000/guilds/default
curl -s http://localhost:3000/memory/health
```

Server verification returned a healthy notebook-mode API and the default E-Commerce guild with required roles.

Fork verification:

```bash
cd worktrees/guild-ai-claw-fork
npm install --package-lock=false
npm run build
npm run test:api
./node_modules/.bin/tsx server/index.ts
```

Verified fork routes:

- `GET /api/guild-ai/health`
- `POST /api/guild-ai/templates/import`
- `GET /api/guild-ai/templates`
- `GET /api/guild-ai/templates/ecom-001`
- `GET /api/guild-ai/accounting/ecom-001`
- `GET /api/guild-ai/capabilities/ecom-001`
- `GET /api/guild-ai/briefing/ecom-001`
- `GET /api/guild-ai/visual/ecom-001/manifest`
- `GET /api/guild-ai/deployment/ecom-001/readiness`
- `GET /api/guild-ai/backup/ecom-001/readiness`
- `GET /api/guild-ai/community/ecom-001/participants`
- `GET /api/guild-ai/community/ecom-001/sessions`
- `POST /api/guild-ai/community/ecom-001/sessions`
- `GET /api/guild-ai/community/sessions/:sessionId`
- `GET /api/guild-ai/launch/ecom-001/readiness`
- `POST /api/guild-ai/upgrades/proposals`
- `GET /api/guild-ai/upgrades/ecom-001`
- `POST /api/guild-ai/upgrades/:proposalId/decision`
- `GET /api/guild-ai/upgrades/:proposalId/events`
- `POST /api/guild-ai/advice`
- `GET /api/guild-ai/advice/ecom-001`
- `GET /api/guild-ai/memory/ecom-001`
- `POST /api/guild-ai/memory`
- `GET /api/guild-ai/hr/ecom-001/reviews`
- `POST /api/guild-ai/hr/reviews`
- `GET /api/guild-ai/governance/ecom-001/requests`
- `POST /api/guild-ai/governance/:requestId/decision`
- `GET /api/guild-ai/accounting/ecom-001/accounts`
- `POST /api/guild-ai/accounting/token-usage`
- `POST /api/guild-ai/accounting/ai-credit-topup`
- `POST /api/guild-ai/accounting/revenue`
- `GET /api/guild-ai/accounting/ecom-001/pnl`
- `GET /api/guild-ai/accounting/ecom-001/journal`
- `GET /api/guild-ai/accounting/ecom-001/model-pricing`
- `POST /api/guild-ai/accounting/model-pricing`
- `GET /api/guild-ai/runtime/ecom-001/bindings`
- `POST /api/guild-ai/runtime/ecom-001/ollama-bootstrap`
- `POST /api/guild-ai/runtime/ecom-001/smoke`
- `POST /api/guild-ai/runtime/ecom-001/task-smoke`
- `GET /api/guild-ai/runtime/ecom-001/task-smokes`
- `POST /api/guild-ai/tasks/:taskId/run-smoke`
- `POST /api/guild-ai/tasks/:taskId/route-decision`
- `GET /api/guild-ai/tasks/:taskId/logs`
- `GET /api/guild-ai/tasks/:taskId/artifacts`

Latest fork test result:

- API: 72 test files passed, 272 tests passed.
- API latest: 75 test files passed, 275 tests passed.
- API latest after Community Lounge: 76 test files passed, 277 tests passed.
- Web: 25 test files passed, 76 tests passed.
- Build: `npm run build` passed.
- Local MVP acceptance: `npm run guild:mvp-check` passed, 10/10 gates.
- L2 memory: targeted tests for `server/modules/guild-ai/memory.test.ts` and `server/modules/guild-ai/briefing.test.ts` passed.
- HR governance: targeted tests for `server/modules/guild-ai/hr-governance.test.ts` and `server/modules/guild-ai/briefing.test.ts` passed.
- Deployment readiness: targeted tests for `server/modules/guild-ai/deployment-readiness.test.ts` passed.
- Backup readiness: targeted tests for `server/modules/guild-ai/backup-readiness.test.ts` passed.
- Launch readiness: targeted tests for `server/modules/guild-ai/launch-readiness.test.ts` passed.
- Public repo publish: `origin/main` points at `84586ee feat: publish Guild AI fork snapshot`; local docs/README follow-up commits are ready to push.
- Browser smoke: Guild AI panel visible, Thai accounting chart rendered, sample token spend produced a journal entry, upgrade proposal creation worked, proposal event history rendered, and SGM Advisor advice creation worked.
- Latest code verification also covered final launch readiness aggregation, backup readiness manifest gates for long-running operation, deployment readiness gates for LAN/internet exposure safety, HR productivity review and human governance decision gates, SQLite L2 memory capture/listing/briefing readiness, service revenue journal entries, prepaid AI credit top-ups, prepaid credit balance reduction from token usage, API provider prepaid/fallback payment selection, AI provider/model limit event capture, active-limit pause behavior, runtime binding availability display, SGM runtime readiness metrics and readiness checklist, available-binding selection for smoke and route decisions, guarded staged-smoke execution from the Guild AI panel, scratch smoke brief/result files, scratch artifact API/UI visibility, recent smoke task recovery after reload, smoke result fallback recording from provider output, real Local Ollama Worker smoke execution routed to QA, smoke QA evidence gating and done closure, UI evidence status/qa_pass disabling, local MVP acceptance checker, execution-start preflight switching/blocking for limited Guild runtimes, same-role fallback routing, automatic recovery after cooldown expiry, public-safe OAuth env configuration, GitHub repo publication, README quick start, Guild-aware task route decisions wired into run completion and QA review outcomes, Guild task route UI controls and task log visibility, P&L income calculation, API provider streaming usage parsing, Ollama auto-configuration, Guild runtime binding selection, real Local Ollama runtime bootstrap, and direct-chat token usage capture.

## Known Notes

- `npm install` reported 15 low/moderate dependency vulnerabilities from the dependency tree.
- The fork is now published at `https://github.com/gunaex/guild_ai.git`.
- Local branch `main` tracks `origin/main`; the old shallow upstream-derived branch is kept locally as `upstream-shallow-main`.
- `VECTOR_DB_PROVIDER=chroma` is recognized but the Chroma adapter intentionally reports "not implemented yet" until the L3 memory phase.
- The local fork was verified with `npm` because `pnpm` and `corepack` were not available in this environment.
- `npm start` in the local fork hit upstream's Remotion prestart bootstrap, so direct server verification used `./node_modules/.bin/tsx server/index.ts`.
- Upstream API tests pass outside sandbox: 46 test files, 203 tests.
- The fork dependency tree reported 2 critical vulnerabilities during `npm install`; audit before production.
- OAuth provider credentials are no longer embedded. Set `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_ID`, and `OAUTH_GOOGLE_CLIENT_SECRET` when those integrations are needed.

## Next Step

Next code step inside `worktrees/guild-ai-claw-fork`:

1. Push the local MVP completion commits to `origin/main`.
2. Keep the fork runtime running locally and use `npm run guild:mvp-check` as the acceptance gate after changes.
3. For today's test, open the Guild AI panel, check Final launch readiness, generate the Daily PM report, run `Score today`, then run `npm run guild:mvp-check` and `npm run guild:doctor`.
4. Restart the fork runtime once so the new bundled `software-001` and `content-001` templates auto-seed into the live DB.
5. For internet/LAN use, keep deployment readiness green and run dependency/security audit before exposing beyond loopback.
6. Future polish: richer Phaser renderer, deeper Chroma embedding upsert/query, replacement persona generation, and component splitting for `GuildAiPanel`.

Speed rule:

- Read `docs/SPEED_LANE.md` before taking shortcuts.
- Do not remove or block the long-term visual layer, SGM Advisor, HR governance, memory, Thai accounting, or deployment hardening while accelerating MVP work.
