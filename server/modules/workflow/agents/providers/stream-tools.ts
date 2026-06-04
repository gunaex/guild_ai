type DbLike = {
  prepare: (sql: string) => {
    get: (...args: any[]) => unknown;
  };
};

type CreateStreamToolsDeps = {
  db: DbLike;
  broadcast: (event: string, payload: unknown) => void;
  normalizeStreamChunk: (raw: Buffer | string, opts?: { dropCliNoise?: boolean }) => string;
  createSubtaskFromCli: (taskId: string, cliToolUseId: string, title: string) => void;
  completeSubtaskFromCli: (cliToolUseId: string) => void;
};

export type StreamUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

export function createStreamTools(deps: CreateStreamToolsDeps) {
  const { db, broadcast, normalizeStreamChunk, createSubtaskFromCli, completeSubtaskFromCli } = deps;

  function parseHttpAgentSubtasks(taskId: string, textChunk: string, accum: { buf: string }): void {
    accum.buf += textChunk;
    // Only scan when we see a closing brace (potential JSON end)
    if (!accum.buf.includes("}")) return;

    // Detect plan: {"subtasks": [...]}
    const planMatch = accum.buf.match(/\{"subtasks"\s*:\s*\[.*?\]\}/s);
    if (planMatch) {
      try {
        const plan = JSON.parse(planMatch[0]) as { subtasks: { title: string }[] };
        for (const st of plan.subtasks) {
          const stId = `http-plan-${st.title.slice(0, 30).replace(/\s/g, "-")}-${Date.now()}`;
          const existing = db
            .prepare("SELECT id FROM subtasks WHERE task_id = ? AND title = ? AND status != 'done'")
            .get(taskId, st.title) as { id: string } | undefined;
          if (!existing) {
            createSubtaskFromCli(taskId, stId, st.title);
          }
        }
      } catch {
        /* ignore malformed JSON */
      }
      // Remove matched portion to avoid re-detection
      accum.buf = accum.buf.slice(accum.buf.indexOf(planMatch[0]) + planMatch[0].length);
    }

    // Detect completion: {"subtask_done": "..."}
    const doneMatch = accum.buf.match(/\{"subtask_done"\s*:\s*"(.+?)"\}/);
    if (doneMatch) {
      const doneTitle = doneMatch[1];
      const sub = db
        .prepare("SELECT cli_tool_use_id FROM subtasks WHERE task_id = ? AND title = ? AND status != 'done' LIMIT 1")
        .get(taskId, doneTitle) as { cli_tool_use_id: string } | undefined;
      if (sub) completeSubtaskFromCli(sub.cli_tool_use_id);
      accum.buf = accum.buf.slice(accum.buf.indexOf(doneMatch[0]) + doneMatch[0].length);
    }

    // Prevent unbounded growth: keep only last 2KB
    if (accum.buf.length > 2048) {
      accum.buf = accum.buf.slice(-1024);
    }
  }

  function createSafeLogStreamOps(logStream: any): {
    safeWrite: (text: string) => boolean;
    safeEnd: (onDone?: () => void) => void;
    isClosed: () => boolean;
  } {
    let ended = false;
    const isClosed = () => ended || Boolean(logStream?.destroyed || logStream?.writableEnded || logStream?.closed);
    const safeWrite = (text: string): boolean => {
      if (!text || isClosed()) return false;
      try {
        logStream.write(text);
        return true;
      } catch {
        ended = true;
        return false;
      }
    };
    const safeEnd = (onDone?: () => void): void => {
      if (isClosed()) {
        ended = true;
        onDone?.();
        return;
      }
      ended = true;
      try {
        logStream.end(() => onDone?.());
      } catch {
        onDone?.();
      }
    };
    return { safeWrite, safeEnd, isClosed };
  }

  // Parse OpenAI-compatible SSE stream (for Copilot)
  async function parseSSEStream(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    safeWrite: (text: string) => boolean,
    taskId?: string,
  ): Promise<StreamUsage | null> {
    const decoder = new TextDecoder();
    let buffer = "";
    const subtaskAccum = { buf: "" };
    let usage: StreamUsage | null = null;

    const captureUsage = (data: any) => {
      const raw = data?.usage;
      if (!raw || typeof raw !== "object") return;
      const promptTokens = Number(raw.prompt_tokens ?? raw.input_tokens ?? 0);
      const completionTokens = Number(raw.completion_tokens ?? raw.output_tokens ?? 0);
      const totalTokens = Number(raw.total_tokens ?? promptTokens + completionTokens);
      const costUsd = Number(raw.cost_usd ?? raw.response_cost ?? data?.response_cost ?? data?.total_cost_usd ?? 0);
      if (!Number.isFinite(promptTokens) && !Number.isFinite(completionTokens) && !Number.isFinite(totalTokens)) return;
      usage = {
        promptTokens: Math.max(0, Math.trunc(Number.isFinite(promptTokens) ? promptTokens : 0)),
        completionTokens: Math.max(0, Math.trunc(Number.isFinite(completionTokens) ? completionTokens : 0)),
        totalTokens: Math.max(0, Math.trunc(Number.isFinite(totalTokens) ? totalTokens : 0)),
        costUsd: Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0,
      };
    };

    const processLine = (trimmed: string) => {
      if (!trimmed || trimmed.startsWith(":")) return;
      if (!trimmed.startsWith("data: ")) return;
      if (trimmed === "data: [DONE]") return;
      try {
        const data = JSON.parse(trimmed.slice(6));
        captureUsage(data);
        const delta = data.choices?.[0]?.delta;
        if (delta?.content) {
          const text = normalizeStreamChunk(delta.content);
          if (!text) return;
          safeWrite(text);
          if (taskId) {
            broadcast("cli_output", { task_id: taskId, stream: "stdout", data: text });
            parseHttpAgentSubtasks(taskId, text, subtaskAccum);
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
    return usage;
  }

  // Parse Gemini/Antigravity SSE stream
  async function parseGeminiSSEStream(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    safeWrite: (text: string) => boolean,
    taskId?: string,
  ): Promise<StreamUsage | null> {
    const decoder = new TextDecoder();
    let buffer = "";
    const subtaskAccum = { buf: "" };
    let usage: StreamUsage | null = null;

    const captureUsage = (data: any) => {
      const raw = data?.usageMetadata ?? data?.response?.usageMetadata;
      if (!raw || typeof raw !== "object") return;
      const promptTokens = Number(raw.promptTokenCount ?? 0);
      const completionTokens = Number(raw.candidatesTokenCount ?? 0);
      const totalTokens = Number(raw.totalTokenCount ?? promptTokens + completionTokens);
      usage = {
        promptTokens: Math.max(0, Math.trunc(Number.isFinite(promptTokens) ? promptTokens : 0)),
        completionTokens: Math.max(0, Math.trunc(Number.isFinite(completionTokens) ? completionTokens : 0)),
        totalTokens: Math.max(0, Math.trunc(Number.isFinite(totalTokens) ? totalTokens : 0)),
        costUsd: 0,
      };
    };

    const processLine = (trimmed: string) => {
      if (!trimmed || trimmed.startsWith(":")) return;
      if (!trimmed.startsWith("data: ")) return;
      try {
        const data = JSON.parse(trimmed.slice(6));
        captureUsage(data);
        const candidates = data.response?.candidates ?? data.candidates;
        if (Array.isArray(candidates)) {
          for (const candidate of candidates) {
            const parts = candidate?.content?.parts;
            if (Array.isArray(parts)) {
              for (const part of parts) {
                if (part.text) {
                  const text = normalizeStreamChunk(part.text);
                  if (!text) continue;
                  safeWrite(text);
                  if (taskId) {
                    broadcast("cli_output", { task_id: taskId, stream: "stdout", data: text });
                    parseHttpAgentSubtasks(taskId, text, subtaskAccum);
                  }
                }
              }
            }
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
    return usage;
  }

  return {
    parseHttpAgentSubtasks,
    createSafeLogStreamOps,
    parseSSEStream,
    parseGeminiSSEStream,
  };
}
