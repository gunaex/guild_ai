import fs from "node:fs";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { decryptSecret } from "../../../../oauth/helpers.ts";
import {
  estimateTokenCostUsd,
  getPrepaidAiCreditBalance,
  recordTokenUsageWithJournal,
} from "../../../guild-ai/accounting-journal.ts";
import {
  classifyAiLimit,
  getActiveAiLimit,
  parseRetryAfterMs,
  recordAiLimitEvent,
} from "../../../guild-ai/limit-events.ts";
import type { StreamUsage } from "./stream-tools.ts";
import type { ApiProviderRow } from "./types.ts";

type DbLike = {
  prepare: (sql: string) => {
    get: (...args: any[]) => unknown;
    all: (...args: any[]) => unknown[];
    run: (...args: any[]) => unknown;
  };
};

type CreateApiProviderToolsDeps = {
  db: DbLike;
  logsDir: string;
  activeProcesses: Map<string, ChildProcess>;
  broadcast: (event: string, payload: unknown) => void;
  normalizeStreamChunk: (raw: Buffer | string, opts?: { dropCliNoise?: boolean }) => string;
  handleTaskRunComplete: (taskId: string, exitCode: number) => void;
  createSafeLogStreamOps: (logStream: any) => {
    safeWrite: (text: string) => boolean;
    safeEnd: (onDone?: () => void) => void;
    isClosed: () => boolean;
  };
  parseSSEStream: (
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    safeWrite: (text: string) => boolean,
    taskId?: string,
  ) => Promise<StreamUsage | null>;
  parseGeminiSSEStream: (
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    safeWrite: (text: string) => boolean,
    taskId?: string,
  ) => Promise<StreamUsage | null>;
};

export function createApiProviderTools(deps: CreateApiProviderToolsDeps) {
  const {
    db,
    logsDir,
    activeProcesses,
    broadcast,
    normalizeStreamChunk,
    handleTaskRunComplete,
    createSafeLogStreamOps,
    parseSSEStream,
    parseGeminiSSEStream,
  } = deps;

  async function parseAnthropicSSEStream(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    safeWrite: (text: string) => boolean,
    taskId?: string,
  ): Promise<StreamUsage | null> {
    const decoder = new TextDecoder();
    let buffer = "";
    let inputTokens = 0;
    let outputTokens = 0;

    const processLine = (trimmed: string) => {
      if (!trimmed || trimmed.startsWith(":")) return;
      if (!trimmed.startsWith("data: ")) return;
      if (trimmed === "data: [DONE]") return;
      try {
        const data = JSON.parse(trimmed.slice(6));
        const usage = data?.message?.usage ?? data?.usage;
        if (usage && typeof usage === "object") {
          const nextInput = Number(usage.input_tokens ?? usage.prompt_tokens ?? inputTokens);
          const nextOutput = Number(usage.output_tokens ?? usage.completion_tokens ?? outputTokens);
          if (Number.isFinite(nextInput)) inputTokens = Math.max(inputTokens, Math.trunc(nextInput));
          if (Number.isFinite(nextOutput)) outputTokens = Math.max(outputTokens, Math.trunc(nextOutput));
        }
        if (data.type === "content_block_delta" && data.delta?.text) {
          const text = normalizeStreamChunk(data.delta.text);
          if (!text) return;
          safeWrite(text);
          if (taskId) {
            broadcast("cli_output", { task_id: taskId, stream: "stdout", data: text });
          }
        }
      } catch {
        /* ignore */
      }
    };

    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      if (signal.aborted) break;
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) processLine(line.trim());
    }
    if (buffer.trim()) processLine(buffer.trim());
    const totalTokens = inputTokens + outputTokens;
    return totalTokens > 0
      ? { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens, costUsd: 0 }
      : null;
  }

  function getApiProviderById(providerId: string): ApiProviderRow | null {
    return (
      (db.prepare("SELECT * FROM api_providers WHERE id = ?").get(providerId) as unknown as ApiProviderRow) ?? null
    );
  }

  function resolveApiProviderModel(provider: ApiProviderRow, requestedModel: string | null): string {
    if (requestedModel) return requestedModel;
    if (provider.models_cache) {
      try {
        const models = JSON.parse(provider.models_cache) as string[];
        if (models.length > 0) return models[0];
      } catch {
        /* ignore */
      }
    }
    throw new Error(
      `No model specified for API provider '${provider.name}'. ` +
        `Please select a model in the agent settings or run a connection test first to cache available models.`,
    );
  }

  function normalizeApiBaseUrl(rawUrl: string): string {
    let url = rawUrl.replace(/\/+$/, "");
    url = url.replace(/\/(v\d+)\/(chat\/completions|models|messages)$/i, "/$1");
    url = url.replace(/\/v1beta\/models\/.+$/i, "/v1beta");
    return url;
  }

  function buildApiProviderRequest(
    provider: ApiProviderRow,
    model: string,
    prompt: string,
    projectPath: string,
  ): { url: string; headers: Record<string, string>; body: string } {
    const apiKey = provider.api_key_enc ? decryptSecret(provider.api_key_enc) : "";
    const baseUrl = normalizeApiBaseUrl(provider.base_url);

    if (provider.type === "anthropic") {
      const messagesUrl = baseUrl.endsWith("/v1") ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;
      return {
        url: messagesUrl,
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 16384,
          stream: true,
          messages: [{ role: "user", content: prompt }],
          system: `You are a coding assistant. Project path: ${projectPath}`,
        }),
      };
    }

    if (provider.type === "google") {
      const googleBase = baseUrl.endsWith("/v1beta") ? baseUrl : `${baseUrl}/v1beta`;
      const url = `${googleBase}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
      return {
        url,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: `You are a coding assistant. Project path: ${projectPath}` }] },
        }),
      };
    }

    const chatUrl = /\/v\d+$/.test(baseUrl) ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    if (provider.type === "openrouter") {
      headers["HTTP-Referer"] = "https://claw-empire.app";
      headers["X-Title"] = "Claw-Empire";
    }

    return {
      url: chatUrl,
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: `You are a coding assistant. Project path: ${projectPath}` },
          { role: "user", content: prompt },
        ],
        stream: true,
        stream_options: { include_usage: true },
      }),
    };
  }

  function resolveGuildIdForUsage(agentId: string | null | undefined): string | null {
    const normalizedAgentId = typeof agentId === "string" ? agentId.trim() : "";
    if (normalizedAgentId) {
      const role = db
        .prepare("SELECT guild_id FROM guild_agent_roles WHERE agent_id = ? LIMIT 1")
        .get(normalizedAgentId) as { guild_id: string } | undefined;
      if (role?.guild_id) return role.guild_id;
    }

    const single = db
      .prepare("SELECT COUNT(*) AS count, MIN(guild_id) AS guild_id FROM guild_templates")
      .get() as { count: number; guild_id: string | null } | undefined;
    return single?.count === 1 ? (single.guild_id ?? null) : null;
  }

  function resolveAgentIdForUsage(taskId: string | undefined, explicitAgentId: string | null | undefined): string | null {
    const normalized = typeof explicitAgentId === "string" ? explicitAgentId.trim() : "";
    if (normalized) return normalized;
    if (!taskId) return null;
    const task = db.prepare("SELECT assigned_agent_id FROM tasks WHERE id = ?").get(taskId) as
      | { assigned_agent_id: string | null }
      | undefined;
    return task?.assigned_agent_id?.trim() || null;
  }

  function recordGuildAiApiUsage(input: {
    taskId?: string;
    agentId?: string | null;
    provider: ApiProviderRow;
    model: string;
    usage: StreamUsage | null;
  }): void {
    const usage = input.usage;
    if (!usage || usage.totalTokens <= 0) return;

    const agentId = resolveAgentIdForUsage(input.taskId, input.agentId);
    const guildId = resolveGuildIdForUsage(agentId);
    if (!guildId || !agentId) return;

    const costUsd =
      usage.costUsd > 0
        ? usage.costUsd
        : estimateTokenCostUsd(db as any, {
            guildId,
            provider: input.provider.type,
            model: input.model,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
          });
    const prepaidBalance = costUsd > 0 ? getPrepaidAiCreditBalance(db as any, guildId) : 0;

    recordTokenUsageWithJournal(db as any, {
      guildId,
      agentId,
      provider: input.provider.type,
      model: input.model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: usage.costUsd,
      paidFrom: costUsd > 0 && prepaidBalance >= costUsd ? "prepaid_ai_credits" : "accounts_payable",
      createdAt: Date.now(),
    });
  }

  function findGuildApiFallback(input: {
    guildId: string | null;
    currentAgentId: string | null;
    currentApiProviderId: string;
    currentModel: string;
  }): { runtimeAgentId: string; runtimeAgentName: string; apiProviderId: string; apiProviderName: string; model: string } | null {
    if (!input.guildId || !input.currentAgentId) return null;
    const role = db
      .prepare("SELECT role_key FROM guild_agent_roles WHERE guild_id = ? AND agent_id = ? LIMIT 1")
      .get(input.guildId, input.currentAgentId) as { role_key: string } | undefined;
    if (!role?.role_key) return null;

    const candidates = db
      .prepare(
        `SELECT
          b.runtime_agent_id AS runtimeAgentId,
          a.name AS runtimeAgentName,
          b.api_provider_id AS apiProviderId,
          p.name AS apiProviderName,
          b.model AS model
         FROM guild_runtime_bindings b
         JOIN guild_agent_roles r
           ON r.guild_id = b.guild_id
          AND r.agent_id = b.guild_agent_id
         JOIN agents a ON a.id = b.runtime_agent_id
         JOIN api_providers p ON p.id = b.api_provider_id
         WHERE b.guild_id = ?
           AND r.role_key = ?
           AND b.status = 'active'
           AND p.enabled = 1
           AND a.status != 'offline'
           AND b.runtime_agent_id != ?
         ORDER BY b.updated_at DESC, b.created_at DESC`,
      )
      .all(input.guildId, role.role_key, input.currentAgentId) as Array<{
      runtimeAgentId: string;
      runtimeAgentName: string;
      apiProviderId: string;
      apiProviderName: string;
      model: string;
    }>;

    return (
      candidates.find((candidate) => {
        if (candidate.apiProviderId === input.currentApiProviderId && candidate.model === input.currentModel) return false;
        return !getActiveAiLimit(db as any, { apiProviderId: candidate.apiProviderId, model: candidate.model }).limited;
      }) ?? null
    );
  }

  function handoffTaskToFallback(input: {
    taskId?: string;
    fromAgentId: string | null;
    fallback: { runtimeAgentId: string; runtimeAgentName: string; apiProviderName: string; model: string };
    reason: string;
  }): void {
    if (!input.taskId) return;
    const now = Date.now();
    try {
      db.prepare("UPDATE tasks SET assigned_agent_id = ?, updated_at = ? WHERE id = ?").run(
        input.fallback.runtimeAgentId,
        now,
        input.taskId,
      );
      if (input.fromAgentId) {
        db.prepare(
          "UPDATE agents SET status = 'idle', current_task_id = CASE WHEN current_task_id = ? THEN NULL ELSE current_task_id END WHERE id = ?",
        ).run(input.taskId, input.fromAgentId);
        broadcast("agent_status", db.prepare("SELECT * FROM agents WHERE id = ?").get(input.fromAgentId));
      }
      db.prepare("UPDATE agents SET status = 'working', current_task_id = ? WHERE id = ?").run(
        input.taskId,
        input.fallback.runtimeAgentId,
      );
      broadcast("agent_status", db.prepare("SELECT * FROM agents WHERE id = ?").get(input.fallback.runtimeAgentId));
      broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(input.taskId));
      writeTaskLimitLog(
        input.taskId,
        `AI limit fallback: ${input.reason}; switched to ${input.fallback.runtimeAgentName} (${input.fallback.apiProviderName}/${input.fallback.model}).`,
        now,
      );
    } catch {
      /* best effort */
    }
  }

  function writeTaskLimitLog(taskId: string | undefined, message: string, now = Date.now()): void {
    if (!taskId) return;
    try {
      db.prepare("INSERT INTO task_logs (task_id, kind, message, created_at) VALUES (?, 'system', ?, ?)").run(
        taskId,
        message,
        now,
      );
    } catch {
      /* best effort */
    }
  }

  async function executeApiProviderAgent(
    prompt: string,
    projectPath: string,
    logStream: fs.WriteStream,
    signal: AbortSignal,
    taskId?: string,
    apiProviderId?: string | null,
    apiModel?: string | null,
    safeWriteOverride?: (text: string) => boolean,
    usageAgentId?: string | null,
    fallbackDepth = 0,
  ): Promise<void> {
    const safeWrite = safeWriteOverride ?? createSafeLogStreamOps(logStream).safeWrite;

    if (!apiProviderId) {
      throw new Error("No API provider configured for this agent. Set api_provider_id first.");
    }

    const provider = getApiProviderById(apiProviderId);
    if (!provider) {
      throw new Error(`API provider not found: ${apiProviderId}`);
    }
    if (!provider.enabled) {
      throw new Error(`API provider '${provider.name}' is disabled.`);
    }

    const model = resolveApiProviderModel(provider, apiModel ?? null);
    const agentId = resolveAgentIdForUsage(taskId, usageAgentId);
    const guildId = resolveGuildIdForUsage(agentId);
    const activeLimit = getActiveAiLimit(db as any, { apiProviderId: provider.id, model });
    if (activeLimit.limited) {
      const until = activeLimit.event?.activeUntil ? new Date(activeLimit.event.activeUntil).toISOString() : "unknown";
      const fallback = findGuildApiFallback({
        guildId,
        currentAgentId: agentId,
        currentApiProviderId: provider.id,
        currentModel: model,
      });
      if (fallback && fallbackDepth < 2) {
        handoffTaskToFallback({
          taskId,
          fromAgentId: agentId,
          fallback,
          reason: `${provider.name}/${model} active until ${until}`,
        });
        return executeApiProviderAgent(
          prompt,
          projectPath,
          logStream,
          signal,
          taskId,
          fallback.apiProviderId,
          fallback.model,
          safeWrite,
          fallback.runtimeAgentId,
          fallbackDepth + 1,
        );
      }
      const msg = `AI model limit active for ${provider.name}/${model} until ${until}. Other providers/models may continue.`;
      writeTaskLimitLog(taskId, msg);
      throw new Error(msg);
    }

    const header = `[api:${provider.type}] Provider: ${provider.name}, Model: ${model}\n---\n`;
    safeWrite(header);
    if (taskId) broadcast("cli_output", { task_id: taskId, stream: "stderr", data: header });

    const req = buildApiProviderRequest(provider, model, prompt, projectPath);

    const resp = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: req.body,
      signal,
    });

    if (!resp.ok) {
      const text = await resp.text();
      const limitType = classifyAiLimit(resp.status, text);
      if (limitType) {
        const retryAfterMs = parseRetryAfterMs(resp.headers.get("retry-after"));
        const eventId = recordAiLimitEvent(db as any, {
          guildId,
          agentId,
          apiProviderId: provider.id,
          provider: provider.type,
          model,
          limitType,
          statusCode: resp.status,
          message: text || `HTTP ${resp.status}`,
          retryAfterMs,
          sourceId: taskId ?? null,
        });
        const note = `AI limit recorded (#${eventId}) for ${provider.name}/${model}: ${limitType}. Other providers/models remain available.`;
        writeTaskLimitLog(taskId, note);
        const fallback = findGuildApiFallback({
          guildId,
          currentAgentId: agentId,
          currentApiProviderId: provider.id,
          currentModel: model,
        });
        if (fallback && fallbackDepth < 2) {
          handoffTaskToFallback({
            taskId,
            fromAgentId: agentId,
            fallback,
            reason: `${provider.name}/${model} returned ${limitType}`,
          });
          return executeApiProviderAgent(
            prompt,
            projectPath,
            logStream,
            signal,
            taskId,
            fallback.apiProviderId,
            fallback.model,
            safeWrite,
            fallback.runtimeAgentId,
            fallbackDepth + 1,
          );
        }
      }
      throw new Error(`API provider '${provider.name}' error (${resp.status}): ${text}`);
    }

    let usage: StreamUsage | null = null;
    if (provider.type === "anthropic") {
      usage = await parseAnthropicSSEStream(resp.body!, signal, safeWrite, taskId);
    } else if (provider.type === "google") {
      usage = await parseGeminiSSEStream(resp.body!, signal, safeWrite, taskId);
    } else {
      usage = await parseSSEStream(resp.body!, signal, safeWrite, taskId);
    }
    recordGuildAiApiUsage({ taskId, agentId: usageAgentId, provider, model, usage });

    safeWrite(`\n---\n[api:${provider.type}] Done.\n`);
    if (taskId) {
      broadcast("cli_output", { task_id: taskId, stream: "stderr", data: `\n---\n[api:${provider.type}] Done.\n` });
    }
  }

  function launchApiProviderAgent(
    taskId: string,
    apiProviderId: string | null,
    apiModel: string | null,
    prompt: string,
    projectPath: string,
    logPath: string,
    controller: AbortController,
    fakePid: number,
    onComplete?: (exitCode: number) => void,
  ): void {
    const logStream = fs.createWriteStream(logPath, { flags: "a" });
    const { safeWrite, safeEnd } = createSafeLogStreamOps(logStream);
    safeWrite(`\n===== task run start ${new Date().toISOString()} | provider=api =====\n`);

    const promptPath = path.join(logsDir, `${taskId}.prompt.txt`);
    fs.writeFileSync(promptPath, prompt, "utf8");

    const mockProc = {
      pid: fakePid,
      kill: () => {
        controller.abort();
        return true;
      },
    } as unknown as ChildProcess;
    activeProcesses.set(taskId, mockProc);

    const runTask = (async () => {
      let exitCode = 0;
      try {
        await executeApiProviderAgent(
          prompt,
          projectPath,
          logStream,
          controller.signal,
          taskId,
          apiProviderId,
          apiModel,
          safeWrite,
          null,
        );
      } catch (err: any) {
        exitCode = 1;
        if (err.name !== "AbortError") {
          const msg = normalizeStreamChunk(`[api] Error: ${err.message}\n`);
          safeWrite(msg);
          broadcast("cli_output", { task_id: taskId, stream: "stderr", data: msg });
          console.error(`[Claw-Empire] API provider agent error (task ${taskId}): ${err.message}`);
        } else {
          const msg = normalizeStreamChunk(`[api] Aborted by user\n`);
          safeWrite(msg);
          broadcast("cli_output", { task_id: taskId, stream: "stderr", data: msg });
        }
      } finally {
        await new Promise<void>((resolve) => safeEnd(resolve));
        try {
          fs.unlinkSync(promptPath);
        } catch {
          /* ignore */
        }
        if (onComplete) {
          onComplete(exitCode);
        } else {
          handleTaskRunComplete(taskId, exitCode);
        }
      }
    })();

    runTask.catch(() => {});
  }

  return {
    executeApiProviderAgent,
    launchApiProviderAgent,
  };
}
