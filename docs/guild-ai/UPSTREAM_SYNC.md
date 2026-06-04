# Guild AI Upstream Sync Strategy

## Short Answer

Yes. Because Guild AI is built on top of the Claw-Empire fork, upstream upgrades can affect our modifications.

The risk is manageable because Guild AI is mostly additive:

- Guild backend code lives in `server/modules/guild-ai/*`.
- Guild schema is isolated in `server/modules/bootstrap/schema/guild-ai-schema.ts`.
- Guild routes are isolated in `server/modules/routes/guild-ai.ts`.
- Guild UI is mostly isolated in `src/components/guild-ai/GuildAiPanel.tsx` and `src/api/guild-ai.ts`.

The risky areas are the integration points where Guild AI hooks into upstream runtime behavior.

## High-Risk Upstream Areas

Review upstream changes carefully if they touch:

- `server/server-main.ts`
- `server/modules/routes.ts`
- `server/modules/bootstrap/schema/*`
- `server/modules/workflow/*`
- `server/modules/routes/core/tasks/*`
- `server/modules/workflow/agents/providers/*`
- `server/modules/routes/ops/api-providers*`
- `src/app/*`
- `src/api*`
- `src/components/*`
- `package.json` or lockfiles

These can affect DB bootstrapping, route registration, task execution, runtime providers, UI navigation, or build/test behavior.

## Safe Sync Rule

Do not merge upstream directly into `main`.

Use a temporary integration branch:

```bash
cd /home/kanphong/Documents/GUILD_AI/worktrees/guild-ai-claw-fork
git fetch upstream
git checkout -b upstream-sync-YYYY-MM-DD main
npm run guild:upstream-impact
git merge --no-ff upstream/main
```

If conflicts appear, resolve them while preserving:

- `server/modules/guild-ai/*`
- `server/modules/bootstrap/schema/guild-ai-schema.ts`
- `server/modules/routes/guild-ai.ts`
- `src/api/guild-ai.ts`
- `src/components/guild-ai/GuildAiPanel.tsx`
- `templates/guild-ai/*.guild.json`
- `scripts/qa/guild-ai-*`

## Required Verification After Upstream Merge

Run:

```bash
npm run build
npm run test:api
npm run test:web
npm run guild:mvp-check
npm run guild:doctor
```

Then run the main scaffold checks:

```bash
cd /home/kanphong/Documents/GUILD_AI
bash scripts/package-guild-overlay.sh
npm run check
```

Only merge the integration branch back to `main` after all checks pass.

## Impact Command

Use:

```bash
npm run guild:upstream-impact
```

Default comparison:

```text
upstream/main...HEAD
```

If you need another base:

```bash
GUILD_AI_UPSTREAM_BASE=upstream/main GUILD_AI_UPSTREAM_HEAD=main npm run guild:upstream-impact
```

The command groups changed files by risk:

- `critical`: must review before merge
- `high`: likely integration impact
- `medium`: UI/build/API risk
- `guild`: Guild-owned files
- `low`: no direct Guild AI risk mapped

## Production Pinning Policy

Before using Guild AI in a serious production run:

1. Pin the current known-good commit.
2. Tag it.
3. Back up SQLite and logs.
4. Do not pull upstream during an active job.

Suggested tag:

```bash
git tag guild-ai-prod-YYYY-MM-DD
git push origin guild-ai-prod-YYYY-MM-DD
```

## Current Position

As of 2026-06-05:

- `origin/main` is the Guild AI production-grade branch.
- `upstream` points to `https://github.com/GreenSheep01201/claw-empire.git`.
- Upstream upgrades should be treated as integration projects, not automatic updates.
