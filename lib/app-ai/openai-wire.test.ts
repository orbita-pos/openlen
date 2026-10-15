import { describe, expect, it } from "vitest";

import { APP_AI_MODELS } from "./models";
import { completion, completionId, DONE, errorEvent, finishChunk, finishReasonOf, firstChunk, modelList, textChunk, usageChunk, wireUsage } from "./openai-wire";

const H = { id: "chatcmpl-1", created: 1_760_000_000, model: "openlen-fast" };
const data = (s: string) => {
  expect(s.startsWith("data: ")).toBe(true);
  expect(s.endsWith("\n\n")).toBe(true);
  return JSON.parse(s.slice(6, -2)) as Record<string, unknown>;
};

describe("OpenAI's wire", () => {
  it("ids look like OpenAI's", () => {
    expect(completionId()).toMatch(/^chatcmpl-[0-9a-f]{32}$/);
    expect(completionId()).not.toBe(completionId());
  });

  it("a whole completion", () => {
    expect(completion({ ...H, content: "hola", finishReason: "stop", usage: wireUsage({ inputTokens: 5, outputTokens: 2 }) })).toEqual({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1_760_000_000,
      model: "openlen-fast",
      choices: [{ index: 0, message: { role: "assistant", content: "hola", refusal: null }, logprobs: null, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    });
  });

  it("the chunks of a stream", () => {
    expect(data(firstChunk(H))).toEqual({ id: "chatcmpl-1", object: "chat.completion.chunk", created: 1_760_000_000, model: "openlen-fast", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
    expect(data(textChunk(H, "ho"))).toMatchObject({ choices: [{ index: 0, delta: { content: "ho" }, finish_reason: null }] });
    expect(data(finishChunk(H, "length"))).toMatchObject({ choices: [{ index: 0, delta: {}, finish_reason: "length" }] });
    expect(data(usageChunk(H, wireUsage({ inputTokens: 1, outputTokens: 1 })))).toMatchObject({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    expect(DONE).toBe("data: [DONE]\n\n");
    expect(data(errorEvent("upstream_error", "cut"))).toEqual({ error: { message: "cut", type: "api_error", code: "upstream_error", param: null } });
  });

  it("only a clean end has a finish reason", () => {
    expect(finishReasonOf({ kind: "end_turn" })).toBe("stop");
    expect(finishReasonOf({ kind: "max_tokens" })).toBe("length");
    expect(finishReasonOf({ kind: "cancelled" })).toBeNull();
    expect(finishReasonOf({ kind: "error", error: "x" })).toBeNull();
  });

  it("the model list", () => {
    expect(modelList(APP_AI_MODELS)).toEqual({
      object: "list",
      data: [
        { id: "openlen-fast", object: "model", created: 0, owned_by: "openlen" },
        { id: "openlen-smart", object: "model", created: 0, owned_by: "openlen" },
      ],
    });
  });
});
