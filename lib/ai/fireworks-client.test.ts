import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createFireworksJsonClient, type FireworksJsonClientOptions } from "./fireworks-client";
import {
  createPageGenerationBudget,
  type PageBudget,
} from "../generation/page-generation-budget";

const ResultSchema = z.object({ title: z.string().min(1), score: z.number().int().min(0).max(10) }).strict();
const REQUEST = {
  role: "reasoner" as const,
  messages: [
    { role: "system" as const, content: "Return a bounded plan." },
    { role: "user" as const, content: "Plan this landing page." },
  ],
  responseSchema: ResultSchema,
  maxOutputTokens: 256,
  reasoningEffort: "high" as const,
  requestId: "req-safe-123",
};
const USAGE = {
  prompt_tokens: 100,
  completion_tokens: 40,
  total_tokens: 140,
  prompt_tokens_details: { cached_tokens: 30 },
  completion_tokens_details: { reasoning_tokens: 12 },
};
const successEnvelope = (content = JSON.stringify({ title: "Launch", score: 8 }), usage: unknown = USAGE) => ({
  id: "provider-private-id",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
  usage,
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function createClient(options: Omit<FireworksJsonClientOptions, "budget"> & { budget?: PageBudget } = {}) {
  const { budget = createPageGenerationBudget({
    rateCardVersion: "fable-production/2026-08-12",
    mxnPerUsd: 20,
    targetMicromxn: 5_000_000,
    capMicromxn: 10_000_000,
  }), ...rest } = options;
  return createFireworksJsonClient({ ...rest, budget });
}

describe("Fireworks JSON client", () => {
  it("rejects construction without a page budget before any provider call", () => {
    const fetchImpl = vi.fn();
    expect(() => createFireworksJsonClient({ apiKey: "key", fetchImpl } as never)).toThrow("page budget");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends a strict structured request to the one approved role model and returns allowlisted data", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(successEnvelope()));
    const result = await createClient({ apiKey: "secret", fetchImpl, now: () => 50 }).request(REQUEST);

    expect(result).toEqual({
      ok: true,
      value: { title: "Launch", score: 8 },
      modelId: "accounts/fireworks/models/deepseek-v4-flash",
      usage: { inputTokens: 100, cachedTokens: 30, outputTokens: 40, thinkingTokens: 12 },
      durationMs: 0,
      attempts: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.fireworks.ai/inference/v1/chat/completions");
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers).toEqual({ authorization: "Bearer secret", "content-type": "application/json" });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "accounts/fireworks/models/deepseek-v4-flash",
      messages: REQUEST.messages,
      max_tokens: 256,
      reasoning_effort: "high",
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
    expect(body.response_format.json_schema.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["title", "score"],
    });
    expect(JSON.stringify(result)).not.toMatch(/provider-private-id|secret|Return a bounded plan/);
  });

  it("fails before HTTP when the key is missing or the requested effort is outside role policy", async () => {
    const fetchImpl = vi.fn();
    await expect(createClient({ env: {}, fetchImpl }).request(REQUEST))
      .resolves.toMatchObject({ ok: false, code: "missing_key", attempts: 0 });
    await expect(createClient({ apiKey: "key", fetchImpl }).request({ ...REQUEST, role: "visual_critic", reasoningEffort: "high" }))
      .resolves.toMatchObject({ ok: false, code: "provider", attempts: 0, modelId: "accounts/fireworks/models/qwen3p7-plus" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["designer", "accounts/fireworks/models/glm-5p2", "high"],
    ["visual_critic", "accounts/fireworks/models/qwen3p7-plus", "none"],
  ] as const)("trims and allowlists routing for %s", async (role, modelId, reasoningEffort) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(successEnvelope()));
    await createClient({
      apiKey: "key",
      fetchImpl,
      modelIds: { [role]: `  ${modelId}  ` },
    }).request({ ...REQUEST, role, reasoningEffort });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).model).toBe(modelId);
  });

  it("rejects a non-allowlisted model override before HTTP", async () => {
    const fetchImpl = vi.fn();
    const client = createClient({ apiKey: "key", fetchImpl, modelIds: { reasoner: "../unapproved" } });
    await expect(client.request(REQUEST)).resolves.toMatchObject({ ok: false, code: "provider", attempts: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_json", "{"],
    ["schema", JSON.stringify({ title: "Launch", score: 11 })],
  ] as const)("preserves complete safe usage on paid %s failures without retry", async (code, content) => {
    const fetchImpl = vi.fn(async () => jsonResponse(successEnvelope(content)));
    const result = await createClient({ apiKey: "key", fetchImpl }).request(REQUEST);
    expect(result).toMatchObject({
      ok: false,
      code,
      attempts: 1,
      usage: { inputTokens: 100, cachedTokens: 30, outputTokens: 40, thinkingTokens: 12 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed on incomplete usage and does not retry incompatibility", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(successEnvelope(undefined, { prompt_tokens: 10, completion_tokens: 2 })));
    await expect(createClient({ apiKey: "key", fetchImpl }).request(REQUEST))
      .resolves.toMatchObject({ ok: false, code: "provider", attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("accepts complete non-thinking usage when completion details are absent", async () => {
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 40,
      total_tokens: 140,
      prompt_tokens_details: { cached_tokens: 30 },
    };
    const fetchImpl = vi.fn(async () => jsonResponse(successEnvelope(undefined, usage)));
    await expect(createClient({ apiKey: "key", fetchImpl }).request({ ...REQUEST, reasoningEffort: "none" })).resolves.toMatchObject({
      ok: true,
      usage: { inputTokens: 100, cachedTokens: 30, outputTokens: 40, thinkingTokens: 0 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["high", "reasoner", undefined],
    ["high", "reasoner", {}],
    ["max", "designer", undefined],
    ["max", "designer", {}],
  ] as const)("fails closed when %s reasoning usage is absent", async (reasoningEffort, role, completionTokensDetails) => {
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 40,
      total_tokens: 140,
      prompt_tokens_details: { cached_tokens: 30 },
      ...(completionTokensDetails === undefined ? {} : { completion_tokens_details: completionTokensDetails }),
    };
    const fetchImpl = vi.fn(async () => jsonResponse(successEnvelope(undefined, usage)));
    const result = await createClient({ apiKey: "key", fetchImpl }).request({ ...REQUEST, role, reasoningEffort });
    expect(result).toMatchObject({ ok: false, code: "provider", attempts: 1 });
    expect(result).not.toHaveProperty("usage");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing total", { ...USAGE, total_tokens: undefined }],
    ["mismatched total", { ...USAGE, total_tokens: 139 }],
    ["cached above prompt", { ...USAGE, prompt_tokens_details: { cached_tokens: 101 } }],
    ["reasoning above completion", { ...USAGE, completion_tokens_details: { reasoning_tokens: 41 } }],
    ["unsafe reasoning", { ...USAGE, completion_tokens_details: { reasoning_tokens: Number.MAX_SAFE_INTEGER + 1 } }],
  ])("fails closed on %s usage without exposing partial counters", async (_label, usage) => {
    const fetchImpl = vi.fn(async () => jsonResponse(successEnvelope(undefined, usage)));
    const result = await createClient({ apiKey: "key", fetchImpl }).request(REQUEST);
    expect(result).toMatchObject({ ok: false, code: "provider", attempts: 1 });
    expect(result).not.toHaveProperty("usage");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404])("does not retry HTTP %i or leak body bytes", async (status) => {
    const fetchImpl = vi.fn(async () => new Response("PRIVATE RESPONSE BODY", { status }));
    const result = await createClient({ apiKey: "key", fetchImpl }).request(REQUEST);
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "http", attempts: 1 }));
    expect(JSON.stringify(result)).not.toContain("PRIVATE RESPONSE BODY");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry an otherwise retryable status when body bytes or reported usage exist", async () => {
    for (const [response, expectedUsage] of [
      [() => new Response(" ", { status: 429 }), undefined],
      [() => jsonResponse({ usage: USAGE }, 503), { inputTokens: 100, cachedTokens: 30, outputTokens: 40, thinkingTokens: 12 }],
    ] as const) {
      const fetchImpl = vi.fn(async () => response());
      const result = await createClient({ apiKey: "key", fetchImpl }).request(REQUEST);
      expect(result).toMatchObject({ ok: false, code: "http", attempts: 1 });
      if (expectedUsage) expect(result).toMatchObject({ usage: expectedUsage });
      else expect(result).not.toHaveProperty("usage");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it.each([429, 502, 503, 504])("retries empty HTTP %i once with byte-identical payload", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(jsonResponse(successEnvelope()));
    const result = await createClient({ apiKey: "key", fetchImpl }).request(REQUEST);
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe(fetchImpl.mock.calls[0]?.[1]?.body);
  });

  it("reserves before each retry fetch and completes each attempt lease exactly once", async () => {
    const events: string[] = [];
    let leaseNumber = 0;
    const completed = new Set<string>();
    const budget: PageBudget = {
      reserve() {
        const leaseId = `lease-${++leaseNumber}`;
        events.push(`reserve:${leaseId}`);
        return { ok: true, leaseId };
      },
      complete(leaseId) {
        if (completed.has(leaseId)) throw new Error("duplicate completion");
        completed.add(leaseId);
        events.push(`complete:${leaseId}`);
      },
      snapshot: () => { throw new Error("not used"); },
    };
    let fetchCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (): Promise<Response> => {
      fetchCalls += 1;
      events.push(`fetch:${fetchCalls}`);
      return fetchCalls === 1
        ? new Response(null, { status: 503 })
        : jsonResponse(successEnvelope());
    });

    await expect(createClient({ apiKey: "key", fetchImpl, budget }).request(REQUEST))
      .resolves.toMatchObject({ ok: true, attempts: 2 });
    expect(events).toEqual([
      "reserve:lease-1", "fetch:1", "complete:lease-1",
      "reserve:lease-2", "fetch:2", "complete:lease-2",
    ]);
    expect(completed).toEqual(new Set(["lease-1", "lease-2"]));
  });

  it("completes the lease once when caller schema parsing throws", async () => {
    const complete = vi.fn();
    const budget: PageBudget = {
      reserve: () => ({ ok: true, leaseId: "lease-1" }),
      complete,
      snapshot: () => { throw new Error("not used"); },
    };
    const throwingSchema = ResultSchema.superRefine(() => { throw new Error("schema parser failed"); });
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(successEnvelope()));

    await expect(createClient({ apiKey: "key", fetchImpl, budget }).request({ ...REQUEST, responseSchema: throwingSchema }))
      .resolves.toMatchObject({ ok: false, code: "provider", attempts: 1 });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith("lease-1", {
      inputTokens: 100, cachedTokens: 30, outputTokens: 40, thinkingTokens: 12,
    });
  });

  it("covers response-body timeout without retry and returns only a typed redacted failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ({ ok: true, status: 200, text: () => new Promise<string>(() => {}) }) as Response);
    const result = await createClient({ apiKey: "key", fetchImpl, timeoutMs: 5 }).request(REQUEST);
    expect(result).toMatchObject({ ok: false, code: "timeout", attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(Object.keys(result).sort()).toEqual(["attempts", "code", "durationMs", "modelId", "ok"].sort());
  });

  it("does not duplicate a response whose body delivers partial bytes and then stalls", async () => {
    const partialBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"choices":'));
      },
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(partialBody, { status: 200 }));
    const result = await createClient({ apiKey: "key", fetchImpl, timeoutMs: 5 }).request(REQUEST);
    expect(result).toMatchObject({ ok: false, code: "timeout", attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries one connection timeout with the identical payload", async () => {
    const connectionTimeout = Object.assign(new TypeError("fetch failed"), { cause: { code: "ETIMEDOUT" } });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(connectionTimeout)
      .mockResolvedValueOnce(jsonResponse(successEnvelope()));
    const result = await createClient({ apiKey: "key", fetchImpl }).request(REQUEST);
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe(fetchImpl.mock.calls[0]?.[1]?.body);
  });

  it("returns timeout after two connection timeouts and never retries other connection errors", async () => {
    const connectionTimeout = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ETIMEDOUT" } });
    const timedOutFetch = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(connectionTimeout())
      .mockRejectedValueOnce(connectionTimeout());
    await expect(createClient({ apiKey: "key", fetchImpl: timedOutFetch }).request(REQUEST))
      .resolves.toMatchObject({ ok: false, code: "timeout", attempts: 2 });

    const resetFetch = vi.fn<typeof fetch>()
      .mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }));
    await expect(createClient({ apiKey: "key", fetchImpl: resetFetch }).request(REQUEST))
      .resolves.toMatchObject({ ok: false, code: "provider", attempts: 1 });
    expect(resetFetch).toHaveBeenCalledTimes(1);
  });

  it("reserves every attempt before sending and stops when the shared page budget refuses", async () => {
    const reserve = vi.fn()
      .mockReturnValueOnce({ ok: true, leaseId: "lease-1" })
      .mockReturnValueOnce({ ok: false, code: "budget_exceeded" });
    const complete = vi.fn();
    const budget = { reserve, complete, snapshot: vi.fn() } as unknown as PageBudget;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    const result = await createClient({ apiKey: "key", fetchImpl, budget }).request(REQUEST);
    expect(result).toMatchObject({ ok: false, code: "budget_exceeded", attempts: 1 });
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith("lease-1", {});
  });

  it("never logs request, response, or provider bodies", async () => {
    const spies = ["log", "info", "warn", "error"].map((method) => vi.spyOn(console, method as "log").mockImplementation(() => undefined));
    try {
      await createClient({ apiKey: "PRIVATE KEY", fetchImpl: async () => new Response("PRIVATE BODY", { status: 400 }) }).request(REQUEST);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
