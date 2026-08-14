import { describe, expect, it, vi } from "vitest";

import { createPageGenerationBudget, type PageBudget } from "../generation/page-generation-budget";
import type { FireworksProviderToolCall, FireworksToolTurnRequest } from "./fireworks-contracts";
import { createFireworksToolClient, type FireworksToolClientOptions } from "./fireworks-tool-client";

const REQUEST: FireworksToolTurnRequest = {
  messages: [
    { role: "system", content: "Edit only through tools." },
    { role: "user", content: "Inspect the current canvas." },
  ],
  maxOutputTokens: 512,
  requestId: "creative-turn-1",
};
const USAGE = {
  prompt_tokens: 100,
  completion_tokens: 40,
  total_tokens: 140,
  prompt_tokens_details: { cached_tokens: 30 },
  completion_tokens_details: { reasoning_tokens: 12 },
};

function budget(): PageBudget {
  return createPageGenerationBudget({
    rateCardVersion: "fable-production/2026-08-12",
    mxnPerUsd: 20,
    targetMicromxn: 5_000_000,
    capMicromxn: 10_000_000,
  });
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function envelope(message: Record<string, unknown>, finishReason = "tool_calls", usage: unknown = USAGE) {
  return { id: "provider-private", choices: [{ index: 0, finish_reason: finishReason, message }], usage };
}

function toolCall(id: string, name: string, args: string): FireworksProviderToolCall {
  return { id, type: "function", function: { name, arguments: args } };
}

function client(options: Omit<FireworksToolClientOptions, "budget"> & { budget?: PageBudget } = {}) {
  const { budget: pageBudget = budget(), ...rest } = options;
  return { client: createFireworksToolClient({ apiKey: "key", budget: pageBudget, ...rest }), budget: pageBudget };
}

describe("Fireworks tool client", () => {
  it("accepts a tool-call turn with null content and settles its exact usage", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(envelope({
      role: "assistant",
      content: null,
      reasoning_content: "private chain",
      tool_calls: [toolCall("call-1", "inspect_canvas", "{}")],
    })));
    const setup = client({ fetchImpl });

    const result = await setup.client.turn(REQUEST);

    expect(result).toMatchObject({
      ok: true,
      calls: [{ id: "call-1", name: "inspect_canvas", arguments: {} }],
      content: null,
      usage: { inputTokens: 100, cachedTokens: 30, outputTokens: 40, thinkingTokens: 12 },
    });
    expect(setup.budget.snapshot().modelUsage).toHaveLength(1);
  });

  it("sends the exact bounded OpenAI-compatible tool payload without response_format", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(envelope({
      role: "assistant", content: "I will inspect first.", tool_calls: [toolCall("call-1", "inspect_canvas", "{}")],
    })));
    await client({ fetchImpl }).client.turn(REQUEST);

    const init = fetchImpl.mock.calls[0]?.[1];
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      model: "accounts/fireworks/models/deepseek-v4-flash-0731",
      messages: REQUEST.messages,
      tool_choice: "auto",
      reasoning_effort: "high",
      reasoning_history: "interleaved",
      temperature: 0.2,
      max_tokens: 512,
      user: "creative-turn-1",
    });
    expect(payload).not.toHaveProperty("response_format");
    expect(payload.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function", function: expect.objectContaining({ name: "inspect_canvas" }) }),
      expect.objectContaining({ type: "function", function: expect.objectContaining({ name: "apply_creative_patch" }) }),
      expect.objectContaining({ type: "function", function: expect.objectContaining({ name: "request_image" }) }),
      expect.objectContaining({ type: "function", function: expect.objectContaining({ name: "render_preview" }) }),
    ]));
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer key");
  });

  it("preserves interleaved assistant reasoning and tool calls on the next DeepSeek V4 turn", async () => {
    const messages: FireworksToolTurnRequest["messages"] = [
      ...REQUEST.messages,
      {
        role: "assistant",
        content: null,
        reasoning_content: "inspect before editing",
        tool_calls: [toolCall("call-1", "inspect_canvas", "{}")],
      },
      { role: "tool", tool_call_id: "call-1", content: "{\"targets\":[]}" },
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () => response(envelope({ role: "assistant", content: "Ready.", tool_calls: [] }, "stop")));

    await client({ fetchImpl }).client.turn({ ...REQUEST, messages });

    const payload = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(payload.messages).toEqual(messages);
  });

  it("returns multiple sequential tool calls in provider order", async () => {
    const fetchImpl = vi.fn(async () => response(envelope({
      role: "assistant",
      content: null,
      tool_calls: [
        toolCall("call-1", "inspect_canvas", "{}"),
        toolCall("call-2", "render_preview", "{}"),
        toolCall("call-3", "apply_creative_patch", '{"operations":[{"op":"set_page_css","css":"body{color:red}"}]}'),
      ],
    })));

    await expect(client({ fetchImpl }).client.turn(REQUEST)).resolves.toMatchObject({
      ok: true,
      calls: [
        { id: "call-1", name: "inspect_canvas" },
        { id: "call-2", name: "render_preview" },
        { id: "call-3", name: "apply_creative_patch" },
      ],
    });
  });

  it("accepts a content-only stop turn and rejects inconsistent finish reasons", async () => {
    const contentFetch = vi.fn(async () => response(envelope({ role: "assistant", content: "The canvas is ready." }, "stop")));
    await expect(client({ fetchImpl: contentFetch }).client.turn(REQUEST)).resolves.toMatchObject({
      ok: true, calls: [], content: "The canvas is ready.",
    });

    for (const body of [
      envelope({ role: "assistant", content: "No tools." }, "tool_calls"),
      envelope({ role: "assistant", content: null, tool_calls: [toolCall("call-1", "inspect_canvas", "{}")] }, "stop"),
      envelope({ role: "assistant", tool_calls: [toolCall("call-1", "inspect_canvas", "{}")] }, "tool_calls"),
    ]) {
      await expect(client({ fetchImpl: async () => response(body) }).client.turn(REQUEST))
        .resolves.toMatchObject({ ok: false, code: "invalid_tool_call" });
    }
  });

  it("rejects malformed arguments without exposing them", async () => {
    const privateArgs = '{"prompt":"private prompt"';
    const result = await client({ fetchImpl: async () => response(envelope({
      role: "assistant", content: null, tool_calls: [toolCall("call-1", "request_image", privateArgs)],
    })) }).client.turn(REQUEST);

    expect(result).toMatchObject({ ok: false, code: "invalid_tool_call" });
    expect(JSON.stringify(result)).not.toContain("private prompt");
  });

  it("rejects schema-invalid arguments for a known tool without exposing them", async () => {
    for (const [name, args] of [
      ["inspect_canvas", '{"prompt":"private prompt"}'],
      ["render_preview", '{"extra":"private prompt"}'],
      ["request_image", '{}'],
      ["apply_creative_patch", '{"operations":[{"op":"publish_page","private":"private prompt"}]}'],
    ]) {
      const result = await client({ fetchImpl: async () => response(envelope({
        role: "assistant", content: null, tool_calls: [toolCall("call-1", name, args)],
      })) }).client.turn(REQUEST);
      expect(result).toMatchObject({ ok: false, code: "invalid_tool_call" });
      expect(JSON.stringify(result)).not.toContain("private prompt");
    }
  });

  it("rejects an unknown or ambiguous tool without exposing arguments", async () => {
    for (const call of [
      toolCall("call-1", "publish_private_page", '{"prompt":"private prompt"}'),
      { ...toolCall("call-1", "inspect_canvas", '{"prompt":"private prompt"}'), function: { name: "inspect_canvas", arguments: "{}", ambiguous_name: "request_image" } },
    ]) {
      const result = await client({ fetchImpl: async () => response(envelope({ role: "assistant", content: null, tool_calls: [call] })) })
        .client.turn(REQUEST);
      expect(result).toMatchObject({ ok: false, code: "invalid_tool_call" });
      expect(JSON.stringify(result)).not.toContain("private prompt");
    }
  });

  it("times out while reading success JSON or HTTP text and never retries", async () => {
    for (const fetchImpl of [
      vi.fn<typeof fetch>(async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }) as Response),
      vi.fn<typeof fetch>(async () => ({ ok: false, status: 503, text: () => new Promise(() => {}) }) as Response),
    ]) {
      const result = await client({ fetchImpl, timeoutMs: 5 }).client.turn(REQUEST);
      expect(result).toMatchObject({ ok: false, code: "timeout" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("reserves once, fetches once, and settles once on HTTP failure usage", async () => {
    const events: string[] = [];
    const pageBudget: PageBudget = {
      reserve: () => { events.push("reserve"); return { ok: true, leaseId: "lease-1" }; },
      complete: (_lease, usage) => { events.push(`complete:${JSON.stringify(usage)}`); },
      snapshot: () => { throw new Error("unused"); },
    };
    const fetchImpl = vi.fn(async () => { events.push("fetch"); return response({ usage: USAGE }, 503); });

    await expect(client({ fetchImpl, budget: pageBudget }).client.turn(REQUEST)).resolves.toMatchObject({
      ok: false,
      code: "http",
      usage: { inputTokens: 100, cachedTokens: 30, outputTokens: 40, thinkingTokens: 12 },
    });
    expect(events).toEqual([
      "reserve",
      "fetch",
      'complete:{"inputTokens":100,"cachedTokens":30,"outputTokens":40,"thinkingTokens":12}',
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed before fetch for missing key, invalid request, or exhausted 10 MXN budget", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const missing = createFireworksToolClient({ env: {}, fetchImpl, budget: budget() });
    await expect(missing.turn(REQUEST)).resolves.toMatchObject({ ok: false, code: "missing_key" });

    await expect(client({ fetchImpl }).client.turn({ ...REQUEST, requestId: "bad request id" }))
      .resolves.toMatchObject({ ok: false, code: "provider" });

    const deniedBudget = { reserve: () => ({ ok: false, code: "budget_exceeded" as const }), complete: vi.fn(), snapshot: vi.fn() } as PageBudget;
    await expect(client({ fetchImpl, budget: deniedBudget }).client.turn(REQUEST))
      .resolves.toMatchObject({ ok: false, code: "budget_exceeded" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
