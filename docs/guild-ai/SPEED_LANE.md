# Guild AI Speed Lane

## Purpose

Move faster without flattening the product vision.

Guild AI should reach a strong local-first MVP quickly, but the MVP must still preserve the path toward a long-running AI company with governance, memory, accounting, visual presence, and human-in-the-loop control.

## Two Progress Tracks

- Full vision: the complete Guild AI company system.
- Local-first MVP: the nearest usable version that can run locally with real agents, accounting, governance, and controlled execution.

Every progress report should include both numbers.

## Speed Lane Priorities

Work that unlocks more real system behavior comes first:

1. Runtime reliability: agents must run through configured local or API providers.
2. Operating data: every meaningful run should become token usage, cost, journal entries, task records, or governance events.
3. Safety controls: production-impacting changes need human decision records.
4. Local-first proof: Ollama/local provider support should remain first-class.
5. Restartable operation: docs and autostart must keep moving toward a long-running service.

## Protected Feature Vision

These features should not be deleted, designed away, or made impossible while accelerating:

- Dual visual layer: office/cartoon/Phaser or equivalent visual presence.
- SGM Advisor: recommendations to the human owner, not just agent task automation.
- HR governance: productivity review, replacement proposals, and human approval.
- Thai accounting: five account categories, journal entries, P&L, and audit trail.
- L2/L3 memory: SQLite facts first, optional ChromaDB later.
- LAN/internet deployment: local-first by default, internet only behind explicit security controls.
- Self-improvement governance: proposals, sandboxing, decisions, and outcome records.

## Acceptable Shortcuts

Shortcuts are allowed when they do not close future doors:

- Use manual sample events before real integrations exist.
- Use read-only smoke tests before real task execution.
- Keep ChromaDB optional until L2 memory is stable.
- Build compact UI controls before splitting components.
- Use exact provider/model pricing before a full vendor pricing catalog.

## Forbidden Shortcuts

Do not speed up by doing these:

- Hardcoding a single provider or model as the only future path.
- Bypassing human approval for capability upgrades or production-impacting self-improvement.
- Treating token counters as enough when accounting journal entries are required.
- Replacing the visual/product layer with logs-only thinking.
- Exposing dev servers directly to the internet.
- Hiding task failures instead of routing them into QA, Tech Lead, PM, HR, or accounting evidence.

## Current Speed Lane

The active acceleration lane is:

```text
Local runtime -> real task smoke -> operating data -> governance/accounting feedback loop
```

Next best work:

1. Restart fork runtime and verify new pricing/smoke routes live.
2. Configure model pricing for any paid provider.
3. Run a safe scratch-project task smoke.
4. Convert task results into accounting/governance evidence.
5. Preserve UI/visual roadmap while splitting components only after workflows stabilize.
