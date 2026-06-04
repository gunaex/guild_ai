# Guild AI Handover

## Mission

Turn Guild AI into a long-running autonomous organization framework that works locally first, on a private network second, and on the internet only with explicit security controls.

## Current State

The workspace contains the Guild AI fork built on top of Claw-Empire. The public snapshot is published at `https://github.com/gunaex/guild_ai.git` on `main`.

Important files:

- `README.md`: public Guild AI fork overview, quick start, and upstream Claw-Empire notes.
- `docs/AUTOSTART.md`: boot/startup setup for notebook and server modes.
- `docs/ARCHITECTURE.md`: core architecture.
- `docs/ROADMAP.md`: phase plan.
- `docs/SPEED_LANE.md`: acceleration rules that protect the long-term feature vision.
- `docs/PROGRESS.md`: current progress and verification.
- `docs/FORK_STRATEGY.md`: how to move to the upstream fork path.
- `docs/MEMORY_STRATEGY.md`: SQLite vs ChromaDB decision.
- `docs/UPSTREAM_ANALYSIS.md`: exact map for porting Guild AI into Claw-Empire.
- `templates/ecommerce.guild.json`: first reusable guild template.

## Run Locally

```bash
cp .env.notebook .env
npm install
npm run check
npm run dev:server
```

In another terminal:

```bash
npm run dev:ui
```

## Run On LAN

Use notebook mode first, but bind UI/server to LAN only after adding an auth token.

Minimum requirements before LAN exposure:

- Set `API_AUTH_TOKEN`.
- Keep `.env` out of git.
- Keep DB under `./data` or another backed-up local path.
- Use firewall rules to allow only trusted LAN clients.

## Run On Internet

Do not expose raw dev servers directly.

Minimum internet requirements:

- Reverse proxy with HTTPS.
- Strong API auth.
- Separate public webhook routes from internal admin routes.
- Secrets stored outside git.
- Backups for SQLite and vector memory.
- Update policy that pins upstream versions before applying changes.

Recommended shape:

```text
Internet
  -> HTTPS reverse proxy
  -> authenticated Guild API
  -> local Docker network
  -> Redis / SQLite / optional ChromaDB
```

## Memory Layers

- L1: context window/runtime session.
- L2: SQLite facts, task records, agent history, accounting.
- L3: optional vector memory for RAG and semantic recall.

ChromaDB is useful for L3. It is not required for the first usable MVP.

## Handover Rule For Future AI Developers

Before coding, read these in order:

1. `docs/PROGRESS.md`
2. `docs/SPEED_LANE.md`
3. `docs/FORK_STRATEGY.md`
4. `docs/MEMORY_STRATEGY.md`
5. `docs/ROADMAP.md`
6. `SOURCE_IDEA/idea.txt`

Then make the smallest change that moves the current phase forward.

## Current Best Next Command

The local Claw-Empire based workspace already exists and tracks the published GitHub repo:

```bash
cd worktrees/guild-ai-claw-fork
git status
```

It contains the first server-side Guild AI module, auto-seeds the default guild template, and includes the first Guild AI UI panel with governance and accounting workflows.
Local `main` tracks `origin/main`. The previous shallow upstream-derived branch is preserved locally as `upstream-shallow-main`.
The root `README.md` now includes the Guild AI quick start: clone, install, build, run `./node_modules/.bin/tsx server/index.ts`, bootstrap Ollama runtime, and run the guarded smoke workflow from the Guild AI panel.

## Current Best Next Code Change

Inside the fork, connect real operating data into the existing Guild AI routes:

```text
Local Ollama bootstrap -> Guild runtime bindings -> real local-agent task smoke
LiteLLM / agent token usage -> POST /api/guild-ai/accounting/token-usage
Sales / service income -> POST /api/guild-ai/accounting/revenue
Upgrade decisions -> measured sandbox/prod rollout records
```

API-provider streaming usage is now captured when the provider emits OpenAI-compatible `usage`, Gemini `usageMetadata`, or Anthropic stream usage metadata. Ollama local model support is available through the API provider layer, with an auto-configure route/button that discovers models from `http://localhost:11434/v1/models`. Guild AI can now create runtime bindings from template roles to runnable Claw agents and assign those agents to `Local Ollama`. `ecom-001` has been bootstrapped against the user's local Ollama provider, and a direct-chat smoke through Aria recorded Ollama token usage. A read-only Guild runtime smoke endpoint/UI action now exercises an active runtime binding through the API provider layer without creating tasks or worktrees. Agent conversation clearing also resets stale direct-chat project binding state. Next, restart the fork runtime and run the smoke action from the Guild AI panel, then run a real local-agent task smoke with a safe scratch project binding.
Model pricing configuration now exists for `guild + provider + model`, including provider wildcard rows with `model='*'`. Token usage records estimate cost from pricing when no explicit cost is supplied, and the Guild AI panel can save/view pricing rows. Next, configure pricing for paid providers before validating real paid-provider usage capture.
Prepaid AI credit accounting now exists at `POST /api/guild-ai/accounting/ai-credit-topup`. Top-ups debit `1100 Prepaid AI Credits` and credit cash, accounts payable, or owner capital. Token usage can pay from `prepaid_ai_credits`, reducing the prepaid balance while still recognizing AI token expense. API-provider streaming usage now automatically pays from prepaid credits when the guild has enough balance and falls back to accounts payable when it does not.
Guild AI can now stage a safe scratch task smoke for an active runtime binding. The task is created as `planned` and linked to a temp-directory scratch project. The scratch project includes `GUILD_SMOKE.md` as the local brief and `SMOKE_RESULT.md` as the concrete output target. The Guild AI panel can also start the staged smoke task through `POST /api/guild-ai/tasks/:taskId/run-smoke`. That endpoint is intentionally guarded: it only accepts tasks marked with Guild smoke metadata, rejects non-temp project paths, verifies the role has an available runtime binding, and then starts execution through the normal Guild preflight path. Smoke artifacts are now visible through `GET /api/guild-ai/tasks/:taskId/artifacts` and the Guild AI panel, so `GUILD_SMOKE.md` and `SMOKE_RESULT.md` can be inspected without manually browsing temp directories. API-provider task runs that complete successfully now write provider output into `SMOKE_RESULT.md` for Guild smoke tasks, so local/chat-style runners still produce concrete artifact evidence even when they cannot edit files directly.
Guild-aware task route decisions now exist at `POST /api/guild-ai/tasks/:taskId/route-decision`. Supported decisions are `worker_done`, `qa_pass`, `qa_fail`, and `techlead_escalate`. The policy routes Worker completion to QA review, QA failure back to Worker until retry budget is exhausted, then escalates to Tech Lead and PM. The real run-completion lifecycle now calls `worker_done` for Guild tasks, so successful Guild Worker runs are assigned to the active QA runtime binding automatically. The real review lifecycle now maps Guild QA approval to `qa_pass` and Guild QA hold/revision to `qa_fail`.
The Guild AI panel can stage a Worker task smoke and exercise route decisions directly from the UI, including worker done, QA fail, QA pass, and Tech Lead escalation. It also shows the staged task's current status, assigned agent, and latest task logs through `GET /api/guild-ai/tasks/:taskId/logs`.
API-provider model limits are now governed per provider/model. When an API provider returns 429/rate-limit, quota, billing, or credit exhaustion errors, Guild AI records a row in `guild_ai_limit_events` with retry/active-until metadata. Active limited provider/model pairs are paused before repeat calls, while other providers/models can continue. If a same-role runtime binding is available and not limited, the task is reassigned to that backup agent/provider/model and continues. When the cooldown expires, the row is marked with `recovered_at` and that provider/model becomes callable again automatically. Recent events are available at `GET /api/guild-ai/limits/:guildId` and in the Guild AI panel. Runtime binding rows now also include `availability_status` and `active_limit`, so the Guild AI panel can show available/limited/disabled status before a run starts. Runtime smoke, task smoke, and Guild route decisions now prefer available bindings over known-limited bindings. Real task execution also preflights Guild runtime availability before marking a task in progress or creating a worktree; limited assigned runtimes switch to an available same-role runtime, and fully blocked roles stay pending. SGM briefing metrics now include runtime available/limited counts and blocked-role detection.
GitHub push protection blocked the upstream embedded Google OAuth credentials, so the public Guild AI fork removed embedded OAuth app credentials from `server/oauth/helpers.ts`. Configure OAuth integrations with `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_ID`, and `OAUTH_GOOGLE_CLIENT_SECRET` when needed.
The visual layer now has a renderer-ready manifest contract at `GET /api/guild-ai/visual/:guildId/manifest`. The Guild AI panel shows a visual manifest preview with scene mood, actors, accounting state, governance state, and task state. This keeps the future office/cartoon renderer path alive while MVP work continues.
SGM briefing now exists at `GET /api/guild-ai/briefing/:guildId` and in the Guild AI panel. It summarizes headline status, operating bullets, next actions, and a readiness checklist for runtime bindings, AI limits, scratch smoke, accounting, and governance.

## New Strategic Modules

Guild AI now has a governance direction:

- self-improvement through upgrade proposals;
- human approval before production-impacting upgrades;
- sandbox decision mode;
- upgrade event history;
- SGM Advisor recommendations back to the human owner;
- Thai accounting foundation with five account categories;
- token usage and service revenue double-entry journal records;
- API provider streaming usage parsing for token accounting;
- Ollama local provider auto-configuration;
- Guild role to Claw runtime-agent bindings;
- real Local Ollama direct-chat smoke with token usage capture;
- read-only Guild runtime smoke endpoint and panel action;
- stale direct-chat project binding reset when clearing an agent conversation.
- model pricing configuration and automatic token cost estimation.
- prepaid AI credit top-up accounting and balance tracking.
- automatic prepaid/fallback payment selection for real API-provider token usage.
- safe scratch task smoke staging and guarded smoke-run execution for Guild runtime agents.
- guarded scratch artifact API and panel viewer for `GUILD_SMOKE.md` and `SMOKE_RESULT.md`.
- smoke result fallback recording from API-provider output.
- Guild-aware task route decision policy for Worker, QA, Tech Lead, and PM handoffs.
- real run-completion hook that routes Guild Worker success to QA.
- real review-lifecycle hook that routes Guild QA pass/fail outcomes.
- Guild AI panel controls for staged task route decisions.
- Guild AI panel task log viewer for staged route smoke validation.
- AI limit event capture, active model pause behavior, runtime binding availability, available-binding smoke/routing/execution-start selection, SGM runtime readiness metrics, same-role fallback routing, and automatic cooldown recovery for API providers.
- public-safe OAuth env configuration and GitHub repo publication.
- visual manifest API and panel preview for the future office renderer.
- SGM briefing API and panel section.
- SGM readiness checklist cards for immediate operating readiness.

Important docs:

- `docs/SELF_IMPROVEMENT.md`
- `docs/THAI_ACCOUNTING.md`

## Verification Notes

Fork build:

```bash
npm run build
```

Fork API tests:

```bash
npm run test:api
```

Result: 46 test files and 203 tests passed outside sandbox.

Latest result after guarded Guild smoke artifact visibility:

- API: 62 test files and 252 tests passed.
- Web: 25 test files and 76 tests passed.
- Build: `npm run build` passed.
- Public GitHub repo: `origin/main` at `84586ee feat: publish Guild AI fork snapshot`.
- Public README: Guild AI fork quick start is present at the top of `README.md`.
- Browser smoke: Guild AI panel opens from sidebar, renders Thai accounting chart, records sample token spend into journal entries, creates upgrade proposals, renders proposal event history, and creates SGM Advisor advice.
- Real Local Ollama staged task smoke: Worker/Bolt started through the guarded run endpoint, completed through the API provider with exit code 0, recorded `SMOKE_RESULT.md`, and routed to QA/Hawk review through the Guild lifecycle.
