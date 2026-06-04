# Guild AI Improvements Over Original Claw-Empire

This document summarizes the major Guild AI improvements added on top of the original Claw-Empire fork. It is written as a shareable overview for friends, reviewers, or future contributors.

## 1. Product Direction

Guild AI turns the original AI office into a local-first AI company system.

Core direction:

- local-first operation on the user's machine
- LAN/internet-ready with security gates
- long-running AI company workflow
- human-governed self-improvement
- accounting, cost control, memory, backup, and operational evidence
- optional future expansion to visual office renderer and Chroma L3 RAG

## 2. Guild AI Control Panel

Added a dedicated `Guild AI` panel in the Claw-Empire sidebar.

The panel now shows and controls:

- launch readiness
- SGM briefing
- runtime bindings
- Ollama bootstrap and smoke tests
- staged worker task smoke
- task route decisions
- task logs and smoke artifacts
- Thai accounting chart, P&L, journals
- budget guard
- backup readiness and snapshots
- worker queue
- memory records
- HR reviews and governance requests
- self-improvement proposals and decisions
- SGM advice
- Community Lounge learning workflow

## 3. Multi-Guild Foundation

Original Claw-Empire is office/team-oriented. Guild AI adds guild templates as business units.

Bundled templates:

- `ecom-001` - e-commerce guild
- `software-001` - software/service guild
- `content-001` - content/media guild

Each guild can define roles, runtime mappings, accounting, memory, and operating state.

## 4. Local Ollama Runtime Support

Added local Ollama support for Guild AI agents.

Implemented:

- auto-discovery from `http://localhost:11434/v1/models`
- Local Ollama API provider setup
- model selection that avoids embedding-only models
- runtime bindings from Guild roles to runnable Claw agents
- read-only runtime smoke
- staged task smoke through local agents
- direct-chat token usage capture from real local Ollama interactions

## 5. Safe Runtime Binding Layer

Guild AI adds a runtime binding system so template roles can map to real executable agents.

Implemented:

- role-to-runtime binding table
- active/disabled binding status
- provider/model awareness
- availability status in UI
- limited model avoidance
- same-role fallback when one provider/model is limited

## 6. AI Limit Governance

Added provider/model limit tracking so one limited model does not stop the whole company.

Implemented:

- captures 429, quota, billing, credit exhaustion, and rate-limit failures
- records limit events per provider/model
- pauses only affected provider/model pairs
- allows other provider/model pairs to continue
- automatically marks expired cooldowns as recovered
- uses backup same-role runtime binding when available
- shows active limits in Guild AI panel and SGM briefing

## 7. Thai Accounting Foundation

Added accounting based on the five Thai accounting categories.

Categories:

- asset
- liability
- equity
- revenue
- expense

Implemented:

- chart of accounts
- double-entry journals
- token usage expense journal
- service revenue journal
- AI credit top-up journal
- prepaid AI credit balance
- P&L summary
- accounting API and Guild AI panel UI

## 8. Token Usage and Cost Accounting

Added AI cost capture and pricing controls.

Implemented:

- token usage API
- real provider streaming usage parsing
- OpenAI-compatible usage support
- Gemini usage metadata support
- Anthropic stream usage metadata support
- model pricing table per guild/provider/model
- wildcard provider pricing
- automatic cost estimation
- prepaid credit consumption before accounts payable fallback

## 9. Budget Guard

Added production cost-control gates.

Implemented:

- daily budget
- monthly budget
- hard-stop mode
- warning threshold
- agent spend status
- budget status API
- Guild AI panel UI
- worker queue processing blocked when budget hard-stop is active

## 10. Self-Improvement Governance

Added human-controlled AI upgrade governance.

Implemented:

- capability levels
- max approved level
- upgrade proposals
- upgrade event history
- approve/reject/sandbox/needs_info/cancel decisions
- SGM Advisor advice
- automatic memory capture for governance events
- UI workflow for proposal creation, decision, and event review

## 11. SGM Briefing

Added a Strategic General Manager style briefing layer.

Implemented:

- headline status
- operating bullets
- next actions
- readiness checklist
- runtime metrics
- memory metrics
- accounting/governance/smoke readiness
- active model-limit awareness

## 12. Daily PM Report Scheduler

Added daily operational reporting.

Implemented:

- SQLite PM report table
- deterministic daily PM report builder
- 08:00 Asia/Bangkok scheduler
- latest/list/generate APIs
- Guild AI panel `Generate now` action
- markdown report output
- launch readiness summary
- task, finance, operations, backup, and community sections

## 13. `guild:doctor`

Added an operational health command for quick diagnosis.

Checks include:

- server session
- launch readiness gates
- SGM briefing
- active model limits
- latest PM report
- local Ollama availability

## 14. Local-First MVP Checker

Added `npm run guild:mvp-check`.

It verifies:

- server health
- template seed
- accounting readiness
- operating accounting data
- runtime bindings
- latest smoke state
- smoke artifact evidence
- SGM briefing
- active model-limit blockers

Latest known result: `10/10 gates passed`.

## 15. Real Worker Queue

Added a persistent worker queue for background jobs.

Implemented:

- queue table
- enqueue API
- list API
- process-next API
- status counts
- Guild AI panel controls
- Budget Guard block before processing

## 16. Secretary Office Overlay

Added a CEO-friendly intake layer on the office screen.

Implemented:

- Secretary Office intake overlay
- live queue counts
- handoff into Task Board create-task flow
- draggable overlay
- local browser position persistence
- reset position control so it does not cover the CEO desk

## 17. Backup and Restore Proof

Added backup readiness and automatic backup workflow.

Implemented:

- backup readiness manifest for SQLite DB, WAL/SHM, logs, and security audit log
- `GUILD_AI_BACKUP_DIR` support
- daily backup scheduler
- default 14-day retention
- configurable retention in Settings -> Operations
- manual backup run
- backup snapshot history
- generated backup artifacts ignored from git
- restore proof verification before trusting snapshots
- backup/restore status in Daily PM report

## 18. Security and Deployment Readiness

Added safety gates for local, LAN, and internet exposure.

Implemented checks:

- host binding
- strong API auth token
- allowed origins
- CSRF/session guard
- security audit log path
- Vite dev exposure
- HTTPS reverse-proxy posture

Internet readiness remains blocked unless explicit hardened settings are present.

## 19. Memory System

Added durable SQLite L2 memory and optional Chroma L3 direction.

Implemented:

- `guild_memory_records`
- namespaces: operations, governance, accounting, runtime, customer, learning
- manual memory capture UI/API
- automatic memory for governance/accounting/community events
- SGM memory readiness
- optional Chroma status and RAG endpoint with SQLite fallback

## 20. HR Governance and Productivity Scoring

Added an HR governance foundation for long-running teams.

Implemented:

- HR review records
- real daily productivity scoring
- evidence JSON storage
- scoring from task status, QA signals, rework signals, token cost, runtime bindings, and active model limits
- below-floor governance request creation
- human approval for risky termination/replacement decisions
- UI decision controls

## 21. Guild Task Smoke and Evidence Gates

Added a safe smoke workflow for real local-agent validation.

Implemented:

- scratch task staging
- temp-directory project guard
- `GUILD_SMOKE.md`
- `SMOKE_RESULT.md`
- guarded run endpoint
- task artifact API
- task log API
- recent smoke recovery after reload
- provider output fallback into `SMOKE_RESULT.md`
- UI evidence status
- QA pass blocked until smoke evidence is complete

## 22. Guild-Aware Task Routing

Added a route policy for real office handoff.

Implemented flow:

- Worker done -> QA review
- QA pass -> done
- QA fail -> Worker retry
- retry exhaustion -> Tech Lead escalation
- Tech Lead escalation -> PM awareness

This is wired into real run-completion and review lifecycle hooks.

## 23. Audit Replay

Added audit timeline support.

Audit replay includes:

- tasks
- task logs
- accounting journals
- AI model limits
- HR reviews
- memory records
- governance requests

This helps explain how the AI company reached a decision or state.

## 24. Visual Manifest and Visual Bridge

Added renderer-ready contracts while keeping MVP focused.

Implemented:

- visual manifest API
- Guild AI panel manifest preview
- visual bridge snapshot API
- sequence and recommended polling cadence for future Phaser/pixel renderer

## 25. Community Lounge / Knowledge Steward

Added the first active learning-community workflow.

Implemented:

- break/idle/available participant selection
- Knowledge Steward facilitator
- community sessions
- community messages
- safe skip when fewer than two participants are available
- learning memory creation
- SGM learning advice creation
- Guild AI panel controls
- Daily PM report community evidence

This turns the Library idea from passive storage into an active company learning culture.

## 26. Upstream Safety

Because Guild AI is forked from Claw-Empire, upstream upgrades can affect our modifications.

Added:

- upstream sync guard documentation
- `npm run guild:upstream-impact`
- impact-review mindset before merging future Claw-Empire changes

## 27. Public Repo Readiness

Implemented public-safe publication work:

- removed embedded upstream OAuth credentials
- OAuth credentials now come from environment variables
- README quick start added
- GitHub push protection issue resolved earlier
- repo published to `https://github.com/gunaex/guild_ai.git`

## 28. Verification Status

Latest known verification:

- `npm run build` passed
- `npm run test:api` passed: 76 test files / 277 tests
- `npm run test:web` passed: 25 test files / 76 tests
- `npm run guild:mvp-check` passed: 10/10 gates

## 29. Current Note: Guild AI White Screen

If the Guild AI screen turns white after clicking it, first make sure the latest local commit is running.

Important local commit:

```text
e5ede75 feat: add Guild AI community lounge
```

That commit includes a compatibility fix for older PM daily reports that do not yet contain the new `community` field.

Recommended action:

```bash
cd /home/kanphong/Documents/GUILD_AI/worktrees/guild-ai-claw-fork
git push --no-thin origin main
```

Then restart the local server and refresh the browser.

## Short Pitch

Original Claw-Empire gave us a strong AI office foundation. Guild AI adds the company operating system around it: accounting, budget control, local model runtime, governance, memory, backups, audit, daily reporting, worker queue, secretary intake, and learning community.

The result is no longer just an AI office UI. It is becoming a local-first AI company that can operate, remember, report, control cost, recover from backup, and improve under human governance.
