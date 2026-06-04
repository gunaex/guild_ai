import { describe, expect, it } from "vitest";
import { createStreamTools } from "./stream-tools.ts";

function makeSseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join("\n")));
      controller.close();
    },
  });
}

describe("provider stream tools", () => {
  it("captures OpenAI-compatible streaming usage metadata", async () => {
    const tools = createStreamTools({
      db: { prepare: () => ({ get: () => undefined }) },
      broadcast: () => undefined,
      normalizeStreamChunk: (raw) => String(raw),
      createSubtaskFromCli: () => undefined,
      completeSubtaskFromCli: () => undefined,
    });
    const written: string[] = [];

    const usage = await tools.parseSSEStream(
      makeSseStream([
        'data: {"choices":[{"delta":{"content":"hello"}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17,"response_cost":0.03}}',
        "data: [DONE]",
      ]),
      new AbortController().signal,
      (text) => {
        written.push(text);
        return true;
      },
    );

    expect(written).toEqual(["hello"]);
    expect(usage).toEqual({
      promptTokens: 12,
      completionTokens: 5,
      totalTokens: 17,
      costUsd: 0.03,
    });
  });
});
