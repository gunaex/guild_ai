# Guild AI Learning Community

## Purpose

The existing Library page is the company's skill shelf: it lists available skills, custom skills, learning history, and unlearn actions.

That is useful, but a strong company should not wait for agents to voluntarily open the shelf. Guild AI should add an active learning culture layer.

## Proposed Role: Knowledge Steward

The Knowledge Steward is an office community role that:

- Watches new skills, failed tasks, PM reports, QA feedback, and CEO goals.
- Suggests useful skills or lessons to available agents.
- Creates short learning tasks instead of forcing disruptive retraining.
- Includes the CEO when a lesson affects strategy, risk, cost, or product direction.
- Records what was taught, who accepted it, and whether it improved future output.

## Office Behavior

In the office view, the Knowledge Steward should feel like a person who walks around the company:

1. Visits idle agents with a relevant idea.
2. Broadcasts useful lessons to a department.
3. Invites CEO/PM/Tech Lead/QA into a quick knowledge huddle.
4. Turns good conversations into improvement proposals, memory records, or Library learning jobs.

## Governance

Learning should be guided, not forced:

- Low-risk learning can be suggested automatically.
- Costly or disruptive training needs PM/CEO approval.
- A model/agent at limit should not be forced to learn until recovered.
- Learning effectiveness should appear in HR productivity evidence.

## MVP Implementation Path

1. Add a `Knowledge Steward` Guild role or virtual office assistant. Done as a virtual facilitator in Community Lounge sessions.
2. Add a Guild AI panel section: `Community Lounge`. Done.
3. Let break/idle/available agents talk together without forcing active work interruption. Done.
4. Convert good discussions into learning memory. Done through `guild_memory_records` namespace `learning`.
5. Convert learning recommendations into SGM advice. Done through `guild_human_advice` category `learning`.
6. Add PM daily report evidence. Done: report now includes lounge sessions in the last 24h and latest topic/summary.
7. Later: add office visual event where the steward visits an agent or department.
8. Later: add a `learning_recommendation` worker queue item type if repeated recommendations should become scheduled jobs.

## Implemented APIs

- `GET /api/guild-ai/community/:guildId/participants`
- `GET /api/guild-ai/community/:guildId/sessions`
- `POST /api/guild-ai/community/:guildId/sessions`
- `GET /api/guild-ai/community/sessions/:sessionId`

## Operating Rule

Community Lounge is break-first:

- It only invites agents whose runtime status is `break`, `idle`, or template-only `available`.
- It skips safely when fewer than two participants are available.
- It writes durable learning memory and SGM advice only after a completed session.
- It appears in Daily PM Report so the CEO can see whether learning culture is active.

## Why This Matters

This turns the Library from passive storage into company culture.

The goal is not just stronger individual agents. The goal is shared context: agents, CEO, PM, QA, and specialists discover improvements together before any one person would have known to ask.
