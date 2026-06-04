# Upstream Analysis

Inspected upstream: `https://github.com/GreenSheep01201/claw-empire`

Inspection date: 2026-06-03

Local inspection path used by Codex: `/tmp/claw-empire-inspect`

## Summary

`claw-empire` is a strong base for Guild AI. It already has the expensive parts:

- React/Vite UI.
- Express server.
- SQLite persistence through Node's built-in `node:sqlite`.
- Pixi-based office view.
- Agent manager.
- Task board.
- Settings UI.
- Workflow packs.
- API routes.
- WebSocket sync.
- Docker and systemd deploy files.

Guild AI should be implemented as additive modules inside this upstream rather than as a separate full rewrite.

## Upstream Shape

Important upstream files:

- `server/server-main.ts`: central server bootstrap.
- `server/db/runtime.ts`: SQLite runtime and env-driven DB path.
- `server/modules/bootstrap/schema/base-schema.ts`: core SQLite schema.
- `server/modules/bootstrap/schema/seeds.ts`: default departments, agents, and settings.
- `server/modules/routes.ts`: route registration entrypoint.
- `server/modules/routes/core.ts`: main API route group.
- `server/modules/routes/collab.ts`: collaboration routes.
- `server/modules/routes/ops.ts`: operational routes.
- `server/modules/workflow.ts`: workflow initialization.
- `src/components/OfficeView.tsx`: office UI entry.
- `src/components/agent-manager/*`: agent/department management UI.
- `src/api/organization-projects.ts`: typed API client for agents/tasks/projects.

## Porting Map

Move Guild AI pieces into upstream like this:

| Guild AI scaffold | Upstream target |
| --- | --- |
| `packages/core/src/llm-client/parseLLMResponse.ts` | `server/modules/guild-ai/llm/parse-response.ts` |
| `packages/core/src/guild/*` | `server/modules/guild-ai/templates/*` |
| `packages/core/src/accounting/tokenLedger.ts` | `server/modules/guild-ai/accounting/*` |
| `packages/core/src/memory/*` | `server/modules/guild-ai/memory/*` |
| `templates/*.guild.json` | `templates/guild-ai/*.guild.json` |
| `docs/*.md` | `docs/guild-ai/*.md` |

## Schema Additions

Add a new upstream schema file:

```text
server/modules/bootstrap/schema/guild-ai-schema.ts
```

Then import and call it from `server/server-main.ts` after `applyBaseSchema(db)`.

Recommended tables:

- `guild_templates`
- `guild_agent_roles`
- `guild_token_usage`
- `guild_memory_records`
- `guild_hr_reviews`
- `guild_governance_requests`

Keep these tables additive. Do not modify upstream `agents` or `tasks` until the adapter proves stable.

## Route Additions

Add:

```text
server/modules/routes/guild-ai.ts
```

Suggested first routes:

- `GET /api/guild-ai/templates`
- `GET /api/guild-ai/templates/:guildId`
- `POST /api/guild-ai/templates/import`
- `GET /api/guild-ai/accounting/:guildId`
- `GET /api/guild-ai/memory/:guildId/health`

Then register it in `server/modules/routes.ts`.

## UI Additions

Do not replace upstream OfficeView.

Add a Guild AI panel first:

```text
src/components/guild-ai/GuildAiPanel.tsx
src/api/guild-ai.ts
```

Once stable, let OfficeView read Guild AI role metadata so PM, QA, HR, Accounting, and Workers render with Guild AI labels.

## Memory Decision

Use upstream SQLite first. Add ChromaDB only as an optional L3 adapter behind `VECTOR_DB_PROVIDER=chroma`.

## Practical Next Change In Fork

The first real fork commit should be:

1. Add `server/modules/guild-ai/*`.
2. Add `server/modules/bootstrap/schema/guild-ai-schema.ts`.
3. Register read-only routes.
4. Import `templates/guild-ai/ecommerce.guild.json`.
5. Add tests for template validation and schema creation.
