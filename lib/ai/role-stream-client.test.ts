// lib/ai/role-stream-client.test.ts — the reasoner and the vision role on DeepInfra, with Fireworks behind.
// A fake `fetch` plays both providers: $0, no network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetProviderHealth, isCooling } from "@/lib/agent/provider-health";
import type { FireworksStreamEvent, FireworksStreamRequest } from "./fireworks-stream-client";
import { _resetProviderWarnings, servedBy } from "./providers";
import { createRoleStreamClient } from "./role-stream-client";

const BOTH = { FIREWORKS_API_KEY: "fw-key", DEEPINFRA_API_KEY: "di-key" };
const DEEPINFRA = "https://api.deepinfra.com/v1/openai/chat/completions";
const FIREWORKS = "https://api.fireworks.ai/inference/v1/chat/completions";
const DI_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const FW_MODEL = "accounts/fireworks/models/deepseek-v4p1-flash-1017";

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`;
const usageChunk = (input: number, output: number) =>
  `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } })}\n\n`;
const ok = (text: string, usage: [number, number] = [100, 10]) =>
  new Response(chunk({ content: text }, "stop") + usageChunk(...usage) + "data: [DONE]\n\n", { status: 200 });

interface Sent {
  readonly url: string;
  readonly body: Record<string, unknown>;
  readonly auth: string;
}

/** One answer per call, in order; each may be a Response or a function of the call's signal. */
function fakeFetch(...answers: ((signal?: AbortSignal) => Response | Promise<Response>)[]) {
  const sent: Sent[] = [];
  let i = 0;
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown>, auth: headers.get("authorization") ?? "" });
    const answer = answers[i++];
    if (!answer) throw new Error("no more answers");
    return answer(init?.signal ?? undefined);
  });
  return { sent, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const request = (over: Partial<FireworksStreamRequest> = {}): FireworksStreamRequest => ({
  messages: [
    { role: "system", content: "translate" },
    { role: "user", content: "hola" },
  ],
  maxOutputTokens: 64,
  temperature: 0.2,
  requestId: "localize.en",
  operation: "copy",
  ...over,
});

async function drain(events: AsyncIterable<FireworksStreamEvent>): Promise<FireworksStreamEvent[]> {
  const out: FireworksStreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}
const text = (events: FireworksStreamEvent[]) =>
  events.filter((e): e is Extract<FireworksStreamEvent, { type: "text_delta" }> => e.type === "text_delta").map((e) => e.text).join("");

describe("createRoleStreamClient — the reasoner and the vision role, DeepInfra first", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    _resetProviderHealth();
    _resetProviderWarnings();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("a reasoner call goes to DeepInfra in its dialect: its model, its cache key, the effort as a word", async () => {
    const { sent, fetchImpl } = fakeFetch(() => ok("hello"));
    const events = await drain(createRoleStreamClient({ env: BOTH, fetchImpl }).stream(request({ jsonObject: true })));
    expect(text(events)).toBe("hello");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(DEEPINFRA);
    expect(sent[0]!.auth).toBe("Bearer di-key");
    expect(sent[0]!.body).toMatchObject({
      model: DI_MODEL,
      prompt_cache_key: "localize.en",
      reasoning_effort: "none",
      response_format: { type: "json_object" },
    });
    expect(sent[0]!.body).not.toHaveProperty("user");
  });

  it("the vision role sends its picture to DeepInfra as an image_url block", async () => {
    const { sent, fetchImpl } = fakeFetch(() => ok("{}"));
    await drain(
      createRoleStreamClient({ env: BOTH, fetchImpl }).stream(
        request({ operation: "candidate_scouting", images: [{ mimeType: "image/png", dataBase64: "AAAA" }] }),
      ),
    );
    expect(sent[0]!.url).toBe(DEEPINFRA);
    const messages = sent[0]!.body.messages as { role: string; content: unknown }[];
    expect(messages.at(-1)!.content).toEqual([
      { type: "text", text: "hola" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ]);
  });

  it("app_ai_smart keeps the table's `high`, a word DeepInfra takes", async () => {
    const { sent, fetchImpl } = fakeFetch(() => ok("x"));
    await drain(createRoleStreamClient({ env: BOTH, fetchImpl }).stream(request({ operation: "app_ai_smart" })));
    expect(sent[0]!.body).toMatchObject({ model: DI_MODEL, reasoning_effort: "high" });
  });

  it("the usage names who served it: DeepInfra and its model id", async () => {
    const { fetchImpl } = fakeFetch(() => ok("x", [500, 20]));
    const events = await drain(createRoleStreamClient({ env: BOTH, fetchImpl }).stream(request()));
    expect(events).toContainEqual(
      expect.objectContaining({ type: "usage", inputTokens: 500, outputTokens: 20, provider: "deepinfra", model: DI_MODEL }),
    );
  });

  it("DeepInfra failing before any output → the same call on Fireworks, and the failure never reaches the caller", async () => {
    const { sent, fetchImpl } = fakeFetch(
      () => new Response("upstream exploded", { status: 503 }),
      () => ok("from fireworks", [300, 7]),
    );
    const events = await drain(createRoleStreamClient({ env: BOTH, fetchImpl }).stream(request()));
    expect(sent.map((s) => s.url)).toEqual([DEEPINFRA, FIREWORKS]);
    expect(sent[1]!.body).toMatchObject({ model: FW_MODEL, user: "localize.en", reasoning_effort: "none" });
    expect(text(events)).toBe("from fireworks");
    expect(events.filter((e) => e.type === "done")).toEqual([{ type: "done", stopReason: { kind: "end_turn" } }]);
    expect(events).toContainEqual(expect.objectContaining({ type: "usage", provider: "fireworks", model: FW_MODEL }));
  });

  it("a 4xx that only DeepInfra gives (a field it refuses) also falls back", async () => {
    const { sent, fetchImpl } = fakeFetch(
      () => new Response('{"detail":"response_format not supported"}', { status: 422 }),
      () => ok("ok"),
    );
    const events = await drain(createRoleStreamClient({ env: BOTH, fetchImpl }).stream(request({ jsonObject: true })));
    expect(sent.map((s) => s.url)).toEqual([DEEPINFRA, FIREWORKS]);
    expect(text(events)).toBe("ok");
  });

  it("once text has reached the caller there is no switch: the error passes through", async () => {
    const { sent, fetchImpl } = fakeFetch(() => new Response(chunk({ content: "half a transl" }), { status: 200 }));
    const events = await drain(createRoleStreamClient({ env: BOTH, fetchImpl }).stream(request()));
    expect(sent).toHaveLength(1);
    expect(text(events)).toBe("half a transl");
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: { kind: "error" } });
  });

  it("a context window overflow does not switch: the other provider has the same model and window", async () => {
    const { sent, fetchImpl } = fakeFetch(() => new Response("This model's maximum context length is 1048576 tokens", { status: 400 }));
    const events = await drain(createRoleStreamClient({ env: BOTH, fetchImpl }).stream(request()));
    expect(sent).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: { kind: "error", code: "context_window_exceeded" } });
  });

  it("the caller's abort is not a provider failure: nothing goes to Fireworks", async () => {
    const owner = new AbortController();
    const { sent, fetchImpl } = fakeFetch(() => {
      owner.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const events = await drain(createRoleStreamClient({ env: BOTH, fetchImpl }).stream(request(), { signal: owner.signal }));
    expect(sent).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "done", stopReason: { kind: "cancelled" } });
  });

  it("a 402 (DeepInfra without balance) cools it: the next call goes straight to Fireworks", async () => {
    const { sent, fetchImpl } = fakeFetch(
      () => new Response("insufficient balance", { status: 402 }),
      () => ok("one"),
      () => ok("two"),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = createRoleStreamClient({ env: BOTH, fetchImpl });
    await drain(client.stream(request()));
    expect(isCooling("deepinfra", Date.now())).toBe(true);
    // Said once, when the cooling starts — as the brain says it.
    expect(error.mock.calls.map((c) => String(c[0]))).toEqual(["[ai] deepinfra sin saldo (402): llamadas a fireworks"]);
    error.mockRestore();
    await drain(client.stream(request()));
    expect(sent.map((s) => s.url)).toEqual([DEEPINFRA, FIREWORKS, FIREWORKS]);
  });

  it("a provider that sends nothing in time hands the call to the next one", async () => {
    const { sent, fetchImpl } = fakeFetch(
      (signal) =>
        new Promise<Response>((_, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        }),
      () => ok("late but here"),
    );
    const events = await drain(createRoleStreamClient({ env: BOTH, fetchImpl, firstEventTimeoutMs: 20 }).stream(request()));
    expect(sent.map((s) => s.url)).toEqual([DEEPINFRA, FIREWORKS]);
    expect(text(events)).toBe("late but here");
  });

  it("with the last provider failing too, its error is what the caller gets", async () => {
    const { fetchImpl } = fakeFetch(
      () => new Response("down", { status: 500 }),
      () => new Response("also down", { status: 500 }),
    );
    const events = await drain(createRoleStreamClient({ env: BOTH, fetchImpl }).stream(request()));
    expect(events).toEqual([
      { type: "done", stopReason: expect.objectContaining({ kind: "error", httpStatus: 500, error: expect.stringContaining("also down") }) },
    ]);
  });

  it("OPENLEN_AGENT_PROVIDERS=fireworks turns DeepInfra off for these roles too, without a deploy", async () => {
    const { sent, fetchImpl } = fakeFetch(() => ok("x"));
    await drain(createRoleStreamClient({ env: { ...BOTH, OPENLEN_AGENT_PROVIDERS: "fireworks" }, fetchImpl }).stream(request()));
    expect(sent.map((s) => s.url)).toEqual([FIREWORKS]);
  });

  it("`providers` narrows the list, the way the security review stays on Fireworks", async () => {
    const { sent, fetchImpl } = fakeFetch(() => ok("x"));
    await drain(createRoleStreamClient({ env: BOTH, fetchImpl, providers: ["fireworks"] }).stream(request()));
    expect(sent.map((s) => s.url)).toEqual([FIREWORKS]);
  });

  it("without DeepInfra's key it runs on Fireworks alone", async () => {
    const { sent, fetchImpl } = fakeFetch(() => ok("x"));
    await drain(createRoleStreamClient({ env: { FIREWORKS_API_KEY: "fw-key" }, fetchImpl }).stream(request()));
    expect(sent.map((s) => s.url)).toEqual([FIREWORKS]);
  });

  it("with no key at all it says so, the way the old client did", async () => {
    const { sent, fetchImpl } = fakeFetch();
    const events = await drain(createRoleStreamClient({ env: {}, fetchImpl }).stream(request()));
    expect(sent).toHaveLength(0);
    expect(events).toEqual([{ type: "done", stopReason: { kind: "error", error: "missing_key" } }]);
  });
});

describe("servedBy — what the spend ledger writes as provider and model", () => {
  const usage = (over: Partial<Extract<FireworksStreamEvent, { type: "usage" }>> = {}): FireworksStreamEvent & { type: "usage" } => ({
    type: "usage",
    inputTokens: 1,
    outputTokens: 1,
    cachedTokens: 0,
    thinkingTokens: 0,
    ...over,
  });

  it("the provider and model the usage names", () => {
    expect(servedBy(usage({ provider: "deepinfra", model: DI_MODEL }), "copy")).toEqual({ provider: "deepinfra", model: DI_MODEL });
  });

  it("a usage that names nobody came from the Fireworks client: the role's Fireworks model, as before", () => {
    expect(servedBy(usage(), "page_edit")).toEqual({
      provider: "fireworks",
      model: FW_MODEL,
    });
    expect(servedBy(null, "copy")).toEqual({ provider: "fireworks", model: FW_MODEL });
  });
});
