# Fork Strategy

## Why Fork First

The source blueprint says Guild AI extends a Claw-Empire style office simulator. Building the simulator, agent lifecycle, UI, persistence, Docker runtime, and orchestration from zero would waste time and tokens.

The current best upstream candidate is:

```text
https://github.com/GreenSheep01201/claw-empire
```

Public repo notes checked on 2026-06-03:

- Local-first AI agent office simulator.
- SQLite persistence.
- Pixel-art office UI.
- Docker deployment path.
- CLI/OAuth/API-connected agent orchestration.
- Apache-2.0 license shown on GitHub.

## Recommended Fork Flow

If using GitHub:

1. Fork `GreenSheep01201/claw-empire` into the user's GitHub account.
2. Clone the fork locally.
3. Add upstream remote.

```bash
git clone git@github.com:<your-user>/claw-empire.git guild-ai
cd guild-ai
git remote add upstream https://github.com/GreenSheep01201/claw-empire.git
git fetch upstream
```

If no GitHub fork is available yet:

```bash
git clone https://github.com/GreenSheep01201/claw-empire.git guild-ai-upstream
```

## Porting Plan

Move this scaffold into the fork as a Guild AI layer instead of replacing upstream code.

Likely mapping:

- `packages/core/src/llm-client/parseLLMResponse.ts` -> upstream LLM/provider utilities.
- `packages/core/src/guild/*` -> new universal guild schema module.
- `packages/core/src/accounting/*` -> accounting/token usage module.
- `templates/*.guild.json` -> guild template directory.
- `docs/*.md` -> project handover docs.
- `VECTOR_DB_PROVIDER` env setting -> upstream env/runtime config.

## Keep Upstream Cheap To Maintain

- Do not rewrite upstream UI if a small adapter can feed its existing office view.
- Do not replace SQLite if upstream already uses it.
- Do not force ChromaDB for local mode.
- Keep Guild AI business rules in additive modules.
- Rebase or merge upstream regularly, but pin before production.

## Token-Saving Rule

When asking AI to continue the work, point it to the exact module and document:

```text
Read docs/PROGRESS.md and docs/FORK_STRATEGY.md.
Only implement the next item in docs/ROADMAP.md.
Prefer adapting upstream Claw-Empire modules over creating new systems.
```
