import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { recordGuildMemory } from "./memory.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

export type GuildCommunityParticipant = {
  agentId: string;
  runtimeAgentId: string | null;
  displayName: string;
  roleKey: string;
  status: "break" | "idle" | "available";
};

export type GuildCommunitySessionRow = {
  id: string;
  guild_id: string;
  topic: string;
  status: "completed" | "skipped" | "failed";
  summary: string;
  insight_json: string;
  started_at: number;
  ended_at: number | null;
  created_at: number;
};

export type GuildCommunityMessageRow = {
  id: number;
  session_id: string;
  guild_id: string;
  agent_id: string | null;
  agent_name: string;
  role_key: string;
  message_type: "chat" | "insight" | "recommendation" | "system";
  content: string;
  created_at: number;
};

export type GuildCommunitySessionDetail = {
  session: GuildCommunitySessionRow;
  messages: GuildCommunityMessageRow[];
  participants: GuildCommunityParticipant[];
};

function topicFromEvidence(db: DbLike, guildId: string): string {
  const activeLimit = db
    .prepare(
      `SELECT provider, model
       FROM guild_ai_limit_events
       WHERE guild_id = ?
         AND active_until IS NOT NULL
         AND active_until > unixepoch()*1000
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(guildId) as { provider: string; model: string } | undefined;
  if (activeLimit) return `How can we keep work moving while ${activeLimit.provider}/${activeLimit.model} is limited?`;

  const latestAdvice = db
    .prepare(
      `SELECT title
       FROM guild_human_advice
       WHERE guild_id = ? AND status = 'open'
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(guildId) as { title: string } | undefined;
  if (latestAdvice?.title) return `What should the team learn from: ${latestAdvice.title}?`;

  const latestTask = db
    .prepare("SELECT title FROM tasks ORDER BY updated_at DESC LIMIT 1")
    .get() as { title: string } | undefined;
  if (latestTask?.title) return `What did we learn from recent work: ${latestTask.title}?`;

  return "What can we improve together during this break?";
}

export function listGuildCommunityParticipants(db: DbLike, guildId: string, limit = 6): GuildCommunityParticipant[] {
  const rows = db
    .prepare(
      `SELECT
         r.agent_id AS agentId,
         b.runtime_agent_id AS runtimeAgentId,
         r.display_name AS displayName,
         r.role_key AS roleKey,
         COALESCE(a.status, 'available') AS status
       FROM guild_agent_roles r
       LEFT JOIN guild_runtime_bindings b
         ON b.guild_id = r.guild_id
        AND b.guild_agent_id = r.agent_id
        AND b.status = 'active'
       LEFT JOIN agents a
         ON a.id = b.runtime_agent_id
       WHERE r.guild_id = ?
         AND COALESCE(a.status, 'available') IN ('break','idle','available')
       ORDER BY
         CASE COALESCE(a.status, 'available')
           WHEN 'break' THEN 0
           WHEN 'idle' THEN 1
           ELSE 2
         END,
         CASE r.role_key
           WHEN 'hr' THEN 0
           WHEN 'pm' THEN 1
           WHEN 'qa' THEN 2
           WHEN 'techLead' THEN 3
           WHEN 'worker' THEN 4
           ELSE 5
         END,
         r.display_name ASC
       LIMIT ?`,
    )
    .all(guildId, Math.max(2, Math.min(12, Math.floor(limit)))) as Array<{
    agentId: string;
    runtimeAgentId: string | null;
    displayName: string;
    roleKey: string;
    status: "break" | "idle" | "available";
  }>;
  return rows;
}

function roleLine(participant: GuildCommunityParticipant, topic: string): string {
  const topicHint = topic.length > 70 ? `${topic.slice(0, 67)}...` : topic;
  if (participant.roleKey === "hr") {
    return `I can turn "${topicHint}" into a short learning habit and watch whether it improves tomorrow's productivity score.`;
  }
  if (participant.roleKey === "pm") {
    return `If this helps delivery, I will convert it into one small task or PM report action instead of letting it stay as talk.`;
  }
  if (participant.roleKey === "qa") {
    return "I want one shared checklist from this discussion so future work has clearer acceptance evidence.";
  }
  if (participant.roleKey === "techLead") {
    return "I can identify whether this needs a workflow change, a Library skill, or just a reminder in task instructions.";
  }
  if (participant.roleKey === "accounting") {
    return "I will flag the cost angle and prefer local/cheap learning whenever the Budget Guard is close to warning.";
  }
  return "I can try the lesson in the next safe task and report what actually improved.";
}

export function startGuildCommunityLoungeSession(
  db: DbLike,
  input: { guildId: string; topic?: string | null; now: number; maxParticipants?: number },
): GuildCommunitySessionDetail {
  const participants = listGuildCommunityParticipants(db, input.guildId, input.maxParticipants ?? 5);
  const id = randomUUID();
  const topic = input.topic?.trim() || topicFromEvidence(db, input.guildId);
  const startedAt = input.now;
  const endedAt = input.now + 3 * 60 * 1000;

  if (participants.length < 2) {
    const summary = "Community Lounge skipped because fewer than two break/idle/available participants were available.";
    const insight = { topic, participants: participants.length, skipped: true };
    db.prepare(
      `INSERT INTO guild_community_sessions (
        id, guild_id, topic, status, summary, insight_json, started_at, ended_at, created_at
      ) VALUES (?, ?, ?, 'skipped', ?, ?, ?, ?, ?)`,
    ).run(id, input.guildId, topic, summary, JSON.stringify(insight), startedAt, endedAt, input.now);
    return getGuildCommunitySessionDetail(db, id) ?? {
      session: db.prepare("SELECT * FROM guild_community_sessions WHERE id = ?").get(id) as GuildCommunitySessionRow,
      messages: [],
      participants,
    };
  }

  const summary = `Community Lounge discussed "${topic}" with ${participants.map((p) => p.displayName).join(", ")}. The team agreed to convert break-time knowledge into a lightweight learning recommendation and operating memory.`;
  const learningSuggestion = `Review one Library skill or checklist related to: ${topic}`;
  const insight = {
    topic,
    learningSuggestion,
    participants: participants.map((p) => ({ agentId: p.agentId, displayName: p.displayName, roleKey: p.roleKey, status: p.status })),
    nextAction: "Create one small learning task or memory-backed checklist if the pattern appears again.",
  };

  db.prepare(
    `INSERT INTO guild_community_sessions (
      id, guild_id, topic, status, summary, insight_json, started_at, ended_at, created_at
    ) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?)`,
  ).run(id, input.guildId, topic, summary, JSON.stringify(insight), startedAt, endedAt, input.now);

  const insertMessage = db.prepare(
    `INSERT INTO guild_community_messages (
      session_id, guild_id, agent_id, agent_name, role_key, message_type, content, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertMessage.run(id, input.guildId, null, "Knowledge Steward", "knowledgeSteward", "system", `Break room topic: ${topic}`, input.now);
  participants.forEach((participant, index) => {
    insertMessage.run(
      id,
      input.guildId,
      participant.agentId,
      participant.displayName,
      participant.roleKey,
      "chat",
      roleLine(participant, topic),
      input.now + (index + 1) * 1000,
    );
  });
  insertMessage.run(id, input.guildId, null, "Knowledge Steward", "knowledgeSteward", "insight", summary, endedAt);
  insertMessage.run(
    id,
    input.guildId,
    null,
    "Knowledge Steward",
    "knowledgeSteward",
    "recommendation",
    learningSuggestion,
    endedAt + 1,
  );

  recordGuildMemory(db, {
    guildId: input.guildId,
    namespace: "learning",
    content: summary,
    metadata: { sourceType: "community_lounge", sessionId: id, topic, learningSuggestion },
    createdAt: endedAt,
  });

  db.prepare(
    `INSERT INTO guild_human_advice (
      id, guild_id, advisor_agent_id, category, priority, title, recommendation,
      learning_resources_json, evidence_json, status, created_at
    ) VALUES (?, ?, ?, 'learning', 'medium', ?, ?, ?, ?, 'open', ?)`,
  ).run(
    randomUUID(),
    input.guildId,
    null,
    "Community Lounge learning suggestion",
    learningSuggestion,
    JSON.stringify(["Library", "Community Lounge"]),
    JSON.stringify({ sourceType: "community_lounge", sessionId: id, participants: participants.length }),
    endedAt,
  );

  return getGuildCommunitySessionDetail(db, id) as GuildCommunitySessionDetail;
}

export function listGuildCommunitySessions(db: DbLike, guildId: string, limit = 10): GuildCommunitySessionRow[] {
  return db
    .prepare(
      `SELECT *
       FROM guild_community_sessions
       WHERE guild_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(guildId, Math.max(1, Math.min(50, Math.floor(limit)))) as GuildCommunitySessionRow[];
}

export function getGuildCommunitySessionDetail(db: DbLike, sessionId: string): GuildCommunitySessionDetail | null {
  const session = db.prepare("SELECT * FROM guild_community_sessions WHERE id = ?").get(sessionId) as
    | GuildCommunitySessionRow
    | undefined;
  if (!session) return null;
  const messages = db
    .prepare(
      `SELECT *
       FROM guild_community_messages
       WHERE session_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(sessionId) as GuildCommunityMessageRow[];
  const participants = messages
    .filter((message) => message.agent_id)
    .map((message) => ({
      agentId: message.agent_id as string,
      runtimeAgentId: null,
      displayName: message.agent_name,
      roleKey: message.role_key,
      status: "available" as const,
    }));
  return { session, messages, participants };
}

export function getLatestGuildCommunityInsight(db: DbLike, guildId: string, generatedAt: number): {
  sessions24h: number;
  latestAt: number | null;
  latestSummary: string | null;
  latestTopic: string | null;
} {
  const since = generatedAt - 24 * 60 * 60 * 1000;
  const countRow = db
    .prepare("SELECT COUNT(*) AS count FROM guild_community_sessions WHERE guild_id = ? AND created_at >= ?")
    .get(guildId, since) as { count: number } | undefined;
  const latest = db
    .prepare(
      `SELECT topic, summary, created_at
       FROM guild_community_sessions
       WHERE guild_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(guildId) as { topic: string; summary: string; created_at: number } | undefined;
  return {
    sessions24h: countRow?.count ?? 0,
    latestAt: latest?.created_at ?? null,
    latestSummary: latest?.summary ?? null,
    latestTopic: latest?.topic ?? null,
  };
}
