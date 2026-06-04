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

1. Add a `Knowledge Steward` Guild role or virtual office assistant.
2. Add a `learning_recommendation` queue item type.
3. Use Library learning history plus task failures to suggest one skill per day.
4. Add a Guild AI panel section: `Learning Community`.
5. Add office visual event: steward visits agent or department.
6. Add memory records for accepted lessons.
7. Add PM daily report line: learning suggestions, accepted lessons, and observed impact.

## Why This Matters

This turns the Library from passive storage into company culture.

The goal is not just stronger individual agents. The goal is shared context: agents, CEO, PM, QA, and specialists discover improvements together before any one person would have known to ask.
