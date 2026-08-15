import { describe, expect, it, vi } from "vitest";

import type { PageBudget } from "@/lib/generation/page-generation-budget";
import { createFireworksToolClient, CREATIVE_TOOL_DEFINITIONS } from "./fireworks-tool-client";

const REQUEST = {
  requestId: "page-1.turn-0",
  maxOutputTokens: 8192,
  messages: [
    { role: "system" as const, content: "You improve a landing page through tools." },
    { role: "user" as const, content: "Start by looking at the page." },
  ],
};

// Captured from a real Fireworks DeepSeek V4 Flash tool turn on 2026-08-14.
// Note content:"" (not null), the extra `tools` key on message, and the extra
// `index`/`name` keys on the call — a strict schema would reject all of these.
const REAL_ENVELOPE = {
  choices: [{
    finish_reason: "tool_calls",
    message: {
      role: "assistant",
      content: "",
      reasoning_content: "Let me start by inspecting the canvas.",
      tools: null,
      tool_calls: [{
        index: 0,
        id: "chatcmpl-tool-a2721d046c972566",
        type: "function",
        name: null,
        function: { name: "inspect_canvas", arguments: "{}" },
      }],
    },
  }],
  usage: { prompt_tokens: 484, total_tokens: 530, completion_tokens: 46, prompt_tokens_details: { cached_tokens: 0 } },
};

function makeBudget(over: { reserve?: PageBudget["reserve"] } = {}) {
  const completed: unknown[] = [];
  const budget: PageBudget = {
    reserve: over.reserve ?? (() => ({ ok: true as const, leaseId: "lease-1" })),
    complete: (_leaseId, usage) => { completed.push(usage); },
    snapshot: () => ({ modelUsage: completed }) as never,
  };
  return { budget, completed };
}

function sseBody(frames: readonly unknown[]) {
  const text = `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

/** Turns a whole-response fixture into the deltas the wire actually carries, so
 * every fixture below keeps saying what a turn means rather than how it
 * arrives. */
function framesFor(body: unknown): unknown[] {
  const envelope = body as { choices?: { finish_reason?: string; message?: Record<string, unknown> }[]; usage?: unknown };
  const choice = envelope?.choices?.[0];
  if (!choice) return envelope?.usage ? [{ choices: [], usage: envelope.usage }] : [];
  const message = choice.message ?? {};
  const toolCalls = message.tool_calls as { id?: string; function?: unknown }[] | undefined;
  const delta: Record<string, unknown> = { role: "assistant" };
  if ("content" in message && typeof message.content === "string") delta.content = message.content;
  if (typeof message.reasoning_content === "string") delta.reasoning_content = message.reasoning_content;
  if (toolCalls) delta.tool_calls = toolCalls.map((call, index) => ({ ...call, index }));
  return [
    { choices: [{ index: 0, delta, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason ?? "stop" }] },
    ...(envelope.usage ? [{ choices: [], usage: envelope.usage }] : []),
  ];
}

function makeFetch(body: unknown, status = 200) {
  return makeStreamingFetch(framesFor(body), status);
}

function makeStreamingFetch(frames: readonly unknown[], status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      body: sseBody(frames),
    } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function payloadOf(calls: { init: RequestInit }[]): Record<string, unknown> {
  return JSON.parse(String(calls[0].init.body));
}

describe("Fireworks tool transport", () => {
  it("accepts a real tool-call turn with empty content and provider-added fields", async () => {
    const { budget, completed } = makeBudget();
    const { impl } = makeFetch(REAL_ENVELOPE);
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });

    const result = await client.turn(REQUEST);

    expect(result).toMatchObject({
      ok: true,
      calls: [{ id: "chatcmpl-tool-a2721d046c972566", name: "inspect_canvas", arguments: {} }],
      content: "",
    });
    expect(result.ok && result.usage).toEqual({ inputTokens: 484, cachedTokens: 0, outputTokens: 46, thinkingTokens: 0 });
    expect(result.ok && result.reasoningContent).toBe("Let me start by inspecting the canvas.");
    expect(completed).toHaveLength(1);
  });

  it("accepts a null-content tool turn just the same", async () => {
    const envelope = structuredClone(REAL_ENVELOPE);
    (envelope.choices[0].message as { content: string | null }).content = null;
    const { budget } = makeBudget();
    const { impl } = makeFetch(envelope);
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });
    await expect(client.turn(REQUEST)).resolves.toMatchObject({ ok: true, content: null });
  });

  it("parses tool arguments from their JSON string into an object", async () => {
    const envelope = structuredClone(REAL_ENVELOPE);
    envelope.choices[0].message.tool_calls[0].function = {
      name: "apply_creative_patch",
      arguments: '{"operations":[{"op":"replace_section","targetId":"sec-1","html":"<section>hi</section>"}]}',
    };
    const { budget } = makeBudget();
    const { impl } = makeFetch(envelope);
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });
    const result = await client.turn(REQUEST);
    expect(result.ok && result.calls[0].arguments).toEqual({
      operations: [{ op: "replace_section", targetId: "sec-1", html: "<section>hi</section>" }],
    });
  });

  it("assembles a tool call whose arguments arrive a few characters at a time", async () => {
    const { budget } = makeBudget();
    const { impl } = makeStreamingFetch([
      { choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "Necesito " } }] },
      { choices: [{ index: 0, delta: { reasoning_content: "reescribir el hero." } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "apply_creative_patch", arguments: '{"operations":[{"op":"repl' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'ace_section","targetId":"ol-hero-1",' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"html":"<section>hola</section>"}]}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 100, total_tokens: 340, completion_tokens: 240, prompt_tokens_details: { cached_tokens: 0 } } },
    ]);
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });

    const result = await client.turn(REQUEST);

    expect(result.ok && result.calls).toEqual([{
      id: "call-1",
      name: "apply_creative_patch",
      arguments: { operations: [{ op: "replace_section", targetId: "ol-hero-1", html: "<section>hola</section>" }] },
    }]);
    expect(result.ok && result.reasoningContent).toBe("Necesito reescribir el hero.");
    expect(result.ok && result.usage.outputTokens).toBe(240);
  });

  it("keeps two concurrent tool calls apart by their index, not their arrival order", async () => {
    const { budget } = makeBudget();
    const { impl } = makeStreamingFetch([
      { choices: [{ index: 0, delta: { tool_calls: [
        { index: 1, id: "call-b", function: { name: "render_preview", arguments: "" } },
        { index: 0, id: "call-a", function: { name: "inspect_canvas", arguments: "" } },
      ] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: "{}" } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 10, total_tokens: 30, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } } },
    ]);
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });
    const result = await client.turn(REQUEST);
    expect(result.ok && result.calls.map((call) => call.name)).toEqual(["inspect_canvas", "render_preview"]);
  });

  it("reports a stream that stops before naming a finish reason as incomplete", async () => {
    const { budget, completed } = makeBudget();
    const { impl } = makeStreamingFetch([
      { choices: [{ index: 0, delta: { role: "assistant", content: "a medio " } }] },
      { choices: [], usage: { prompt_tokens: 10, total_tokens: 30, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } } },
    ]);
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });
    await expect(client.turn(REQUEST)).resolves.toMatchObject({
      ok: false, code: "provider", providerCategory: "response_content",
    });
    expect(completed).toHaveLength(1);
  });

  it("streams the turn and asks for usage with it", async () => {
    const { budget } = makeBudget();
    const { impl, calls } = makeFetch(REAL_ENVELOPE);
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });
    await client.turn(REQUEST);
    const payload = payloadOf(calls);
    // Without streaming the whole turn waits on undici's 300s headers timeout,
    // which no deadline of ours can extend.
    expect(payload.stream).toBe(true);
    expect(payload.stream_options).toEqual({ include_usage: true });
  });

  it("sends tools with tool_choice auto and never a response_format", async () => {
    const { budget } = makeBudget();
    const { impl, calls } = makeFetch(REAL_ENVELOPE);
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });
    await client.turn(REQUEST);
    const payload = payloadOf(calls);
    expect(payload.tool_choice).toBe("auto");
    expect(payload.tools).toEqual(CREATIVE_TOOL_DEFINITIONS);
    expect(payload.response_format).toBeUndefined();
    expect(payload.model).toBe("accounts/fireworks/models/deepseek-v4-flash-0731");
  });

  it("declares every creative op name explicitly so the model cannot shorten them", () => {
    const patch = CREATIVE_TOOL_DEFINITIONS.find((tool) => tool.function.name === "apply_creative_patch");
    const opSchema = JSON.stringify(patch);
    // A real turn emitted {"op":"replace"} when op was a free string.
    expect(opSchema).toContain("replace_section");
    expect(opSchema).toContain("enum");
  });

  it("rejects an unknown tool without exposing arguments or the prompt", async () => {
    const envelope = structuredClone(REAL_ENVELOPE);
    envelope.choices[0].message.tool_calls[0].function = {
      name: "exfiltrate",
      arguments: '{"secret":"private prompt"}',
    };
    const { budget } = makeBudget();
    const { impl } = makeFetch(envelope);
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });
    const result = await client.turn(REQUEST);
    expect(result).toMatchObject({ ok: false, code: "invalid_tool_call" });
    expect(JSON.stringify(result)).not.toContain("private prompt");
    expect(JSON.stringify(result)).not.toContain("exfiltrate");
  });

  it("rejects malformed tool arguments", async () => {
    const envelope = structuredClone(REAL_ENVELOPE);
    envelope.choices[0].message.tool_calls[0].function = { name: "inspect_canvas", arguments: "{not json" };
    const { budget } = makeBudget();
    const { impl } = makeFetch(envelope);
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });
    await expect(client.turn(REQUEST)).resolves.toMatchObject({ ok: false, code: "invalid_tool_call" });
  });

  it("gives a turn a deadline its own output ceiling fits inside", async () => {
    vi.useFakeTimers();
    try {
      const { budget } = makeBudget();
      const impl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }));
      const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl as unknown as typeof fetch });
      const pending = client.turn({ ...REQUEST, maxOutputTokens: 24_000 });
      let settled = false;
      void pending.then(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(180_001);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(600_000);
      await expect(pending).resolves.toMatchObject({ ok: false, code: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets an explicit timeout override the derived deadline", async () => {
    vi.useFakeTimers();
    try {
      const { budget } = makeBudget();
      const impl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }));
      const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl as unknown as typeof fetch, timeoutMs: 5_000 });
      const pending = client.turn({ ...REQUEST, maxOutputTokens: 24_000 });
      await vi.advanceTimersByTimeAsync(5_001);
      await expect(pending).resolves.toMatchObject({ ok: false, code: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a tool call cut off by the ceiling as truncation, not as a malformed call", async () => {
    const envelope = structuredClone(REAL_ENVELOPE);
    envelope.choices[0].finish_reason = "length";
    envelope.choices[0].message.tool_calls[0].function = {
      name: "apply_creative_patch",
      arguments: '{"operations":[{"op":"replace_section","targetId":"ol-hero-1","html":"<section',
    };
    const { budget } = makeBudget();
    const { impl } = makeFetch(envelope);
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });
    await expect(client.turn(REQUEST)).resolves.toMatchObject({
      ok: false, code: "provider", providerCategory: "response_truncated",
    });
  });

  it("reports a reasoning-truncated turn as provider truncation, not a silent empty turn", async () => {
    const { budget } = makeBudget();
    const { impl } = makeFetch({
      choices: [{ finish_reason: "length", message: { role: "assistant", content: "", reasoning_content: "thinking…" } }],
      usage: { prompt_tokens: 575, total_tokens: 1275, completion_tokens: 700, prompt_tokens_details: { cached_tokens: 0 } },
    });
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });
    await expect(client.turn(REQUEST)).resolves.toMatchObject({
      ok: false, code: "provider", providerCategory: "response_truncated",
    });
  });

  it("treats a finished turn with no tool calls as the session's own stop signal", async () => {
    const { budget } = makeBudget();
    const { impl } = makeFetch({
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "The page looks good." } }],
      usage: { prompt_tokens: 10, total_tokens: 20, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } },
    });
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });
    await expect(client.turn(REQUEST)).resolves.toMatchObject({ ok: true, calls: [], content: "The page looks good." });
  });

  it("never retries a failed turn", async () => {
    const { budget } = makeBudget();
    const { impl, calls } = makeFetch({ error: "boom" }, 500);
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });
    await expect(client.turn(REQUEST)).resolves.toMatchObject({ ok: false, code: "http", httpStatus: 500 });
    expect(calls).toHaveLength(1);
  });

  it("stops before the network when the budget will not fit the turn", async () => {
    const { budget } = makeBudget({ reserve: () => ({ ok: false as const, code: "budget_exceeded" }) });
    const { impl, calls } = makeFetch(REAL_ENVELOPE);
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });
    await expect(client.turn(REQUEST)).resolves.toMatchObject({ ok: false, code: "budget_exceeded" });
    expect(calls).toHaveLength(0);
  });

  it("fails closed without an API key and never reserves budget", async () => {
    const { budget, completed } = makeBudget();
    const { impl, calls } = makeFetch(REAL_ENVELOPE);
    const client = createFireworksToolClient({ budget, apiKey: "", env: {}, fetchImpl: impl });
    await expect(client.turn(REQUEST)).resolves.toMatchObject({ ok: false, code: "missing_key" });
    expect(calls).toHaveLength(0);
    expect(completed).toHaveLength(0);
  });

  it("passes prior assistant reasoning_content back through untouched", async () => {
    const { budget } = makeBudget();
    const { impl, calls } = makeFetch(REAL_ENVELOPE);
    const client = createFireworksToolClient({ budget, apiKey: "k", fetchImpl: impl });
    await client.turn({
      ...REQUEST,
      messages: [
        ...REQUEST.messages,
        { role: "assistant" as const, content: "", reasoningContent: "earlier thought", toolCalls: [{ id: "t1", name: "inspect_canvas" as const, argumentsJson: "{}" }] },
        { role: "tool" as const, toolCallId: "t1", content: "{}" },
      ],
    });
    const messages = payloadOf(calls).messages as Record<string, unknown>[];
    expect(messages[2]).toMatchObject({ role: "assistant", reasoning_content: "earlier thought" });
    expect(messages[3]).toMatchObject({ role: "tool", tool_call_id: "t1", content: "{}" });
  });
});
