import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createFireworksJsonClient, DEFAULT_FIREWORKS_TIMEOUT_MS, type FireworksJsonClientOptions } from "./fireworks-client";
import {
  createPageGenerationBudget,
  type PageBudget,
} from "../generation/page-generation-budget";

const ResultSchema = z.object({ title: z.string().min(1), score: z.number().int().min(0).max(10) }).strict();
const VALID_JPEG_BASE64 = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDq6KKK/os/KgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==";
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
  it("allows one long structured generation to finish without requiring a retry", () => {
    expect(DEFAULT_FIREWORKS_TIMEOUT_MS).toBe(600_000);
  });

  it("sends one canonical bounded JPEG image block only to the visual critic", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(successEnvelope(undefined, {
      prompt_tokens: 100,
      completion_tokens: 40,
      total_tokens: 140,
      prompt_tokens_details: { cached_tokens: 30 },
    })));
    const jpegUrl = `data:image/jpeg;base64,${VALID_JPEG_BASE64}`;
    const visualRequest = {
      ...REQUEST,
      role: "visual_critic",
      reasoningEffort: "none",
      messages: [
        { role: "system", content: "Return a bounded visual decision." },
        { role: "user", content: [
          { type: "text", text: "Inspect the labeled candidates." },
          { type: "image_url", image_url: { url: jpegUrl } },
        ] },
      ],
    };

    await expect(createClient({ apiKey: "key", fetchImpl }).request(visualRequest as never))
      .resolves.toMatchObject({ ok: true, modelId: "accounts/fireworks/models/qwen3p7-plus" });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).messages).toEqual(visualRequest.messages);
  });

  it("accepts and decodes exactly two separate final viewport images only for Qwen", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(successEnvelope(undefined, {
      prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, prompt_tokens_details: { cached_tokens: 30 },
    })));
    const image = { type: "image_url" as const, image_url: { url: `data:image/jpeg;base64,${VALID_JPEG_BASE64}` } };
    const visualRequest = {
      ...REQUEST,
      role: "visual_critic" as const,
      reasoningEffort: "none" as const,
      messages: [
        { role: "system" as const, content: "Return a bounded final visual decision." },
        { role: "user" as const, content: [{ type: "text" as const, text: "desktop" }, image] },
        { role: "user" as const, content: [{ type: "text" as const, text: "mobile" }, image] },
      ],
    };

    await expect(createClient({ apiKey: "key", fetchImpl }).request(visualRequest as never)).resolves.toMatchObject({ ok: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects non-visual, non-user, duplicate, non-JPEG, non-data, malformed, and oversized image blocks before HTTP", async () => {
    const fetchImpl = vi.fn();
    const jpeg = VALID_JPEG_BASE64;
    const block = { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg}` } };
    const multimodal = (role: string, messages: unknown[]) => ({ ...REQUEST, role, reasoningEffort: role === "visual_critic" ? "none" : "high", messages });
    const invalid = [
      multimodal("reasoner", [{ role: "user", content: [{ type: "text", text: "x" }, block] }]),
      multimodal("designer", [{ role: "user", content: [{ type: "text", text: "x" }, block] }]),
      multimodal("visual_critic", [{ role: "system", content: [{ type: "text", text: "x" }, block] }]),
      multimodal("visual_critic", [{ role: "user", content: [{ type: "text", text: "x" }, block, block] }]),
      multimodal("visual_critic", [{ role: "user", content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: "https://private.invalid/a.jpg" } }] }]),
      multimodal("visual_critic", [{ role: "user", content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: `data:image/png;base64,${jpeg}` } }] }]),
      multimodal("visual_critic", [{ role: "user", content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,not+canonical===" } }] }]),
      multimodal("visual_critic", [{ role: "user", content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${Buffer.alloc(1024 * 1024 + 1).toString("base64")}` } }] }]),
    ];
    for (const request of invalid) {
      await expect(createClient({ apiKey: "key", fetchImpl }).request(request as never))
        .resolves.toMatchObject({ ok: false, code: "provider", attempts: 0 });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fully decodes JPEG bytes and rejects labeled text, header-only, truncated, or corrupt images before lease reservation", async () => {
    const validBytes = Buffer.from(VALID_JPEG_BASE64, "base64");
    const headerOnly = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x40, 0x00, 0x40,
      0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
    ]);
    const corrupt = Buffer.concat([validBytes.subarray(0, validBytes.indexOf(Buffer.from([0xff, 0xda]))), Buffer.from([0xff, 0xd9])]);
    const reserve = vi.fn(() => ({ ok: true as const, leaseId: "must-not-reserve" }));
    const budget: PageBudget = { reserve, complete: vi.fn(), snapshot: vi.fn() as never };
    const fetchImpl = vi.fn();
    for (const bytes of [Buffer.from("not a jpeg"), headerOnly, validBytes.subarray(0, -1), corrupt]) {
      const request = {
        ...REQUEST,
        role: "visual_critic",
        reasoningEffort: "none",
        messages: [{ role: "user", content: [
          { type: "text", text: "inspect" },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${bytes.toString("base64")}` } },
        ] }],
      };
      await expect(createClient({ apiKey: "key", fetchImpl, budget }).request(request as never))
        .resolves.toMatchObject({ ok: false, code: "provider", attempts: 0 });
    }
    expect(reserve).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries a visual request with a byte-identical multimodal payload", async () => {
    const jpegUrl = `data:image/jpeg;base64,${VALID_JPEG_BASE64}`;
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(successEnvelope(undefined, {
        prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, prompt_tokens_details: { cached_tokens: 30 },
      })));
    await createClient({ apiKey: "key", fetchImpl }).request({
      ...REQUEST,
      role: "visual_critic",
      reasoningEffort: "none",
      messages: [{ role: "user", content: [{ type: "text", text: "inspect" }, { type: "image_url", image_url: { url: jpegUrl } }] }],
    } as never);
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe(fetchImpl.mock.calls[0]?.[1]?.body);
  });

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
      modelId: "accounts/fireworks/models/deepseek-v4-flash-0731",
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
      model: "accounts/fireworks/models/deepseek-v4-flash-0731",
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

  it("routes only an explicitly requested call through Priority and reserves its Priority price", async () => {
    const reserve = vi.fn(() => ({ ok: true as const, leaseId: "priority-lease" }));
    const budget: PageBudget = { reserve, complete: vi.fn(), snapshot: vi.fn() as never };
    const priorityFetch = vi.fn<typeof fetch>(async () => jsonResponse(successEnvelope()));
    await expect(createClient({ apiKey: "key", fetchImpl: priorityFetch, budget }).request({
      ...REQUEST,
      serviceTier: "priority",
      maxAttempts: 1,
    })).resolves.toMatchObject({ ok: true, serviceTier: "priority", attempts: 1 });
    expect(JSON.parse(String(priorityFetch.mock.calls[0]?.[1]?.body))).toMatchObject({ service_tier: "priority" });
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({
      kind: "model",
      modelId: "accounts/fireworks/models/deepseek-v4-flash-0731",
      serviceTier: "priority",
    }));

    const standardFetch = vi.fn<typeof fetch>(async () => jsonResponse(successEnvelope()));
    await createClient({ apiKey: "key", fetchImpl: standardFetch }).request(REQUEST);
    expect(JSON.parse(String(standardFetch.mock.calls[0]?.[1]?.body))).not.toHaveProperty("service_tier");
  });

  it("returns only a redacted provider category and HTTP status on Priority failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("PRIVATE PROVIDER BODY", { status: 503 }));
    const result = await createClient({ apiKey: "key", fetchImpl }).request({ ...REQUEST, serviceTier: "priority", maxAttempts: 1 });
    expect(result).toMatchObject({
      ok: false,
      code: "http",
      serviceTier: "priority",
      providerCategory: "http",
      httpStatus: 503,
      attempts: 1,
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE PROVIDER BODY");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("classifies an invalid success envelope and transport failure without retaining error values", async () => {
    const invalidEnvelope = await createClient({
      apiKey: "key",
      fetchImpl: async () => jsonResponse({ private: "DO NOT RETAIN" }),
    }).request({ ...REQUEST, maxAttempts: 1 });
    expect(invalidEnvelope).toMatchObject({ ok: false, code: "provider", providerCategory: "response" });
    expect(JSON.stringify(invalidEnvelope)).not.toContain("DO NOT RETAIN");

    const transport = await createClient({
      apiKey: "key",
      fetchImpl: async () => { throw new Error("PRIVATE CONNECTION DETAIL"); },
    }).request({ ...REQUEST, maxAttempts: 1 });
    expect(transport).toMatchObject({ ok: false, code: "provider", providerCategory: "transport" });
    expect(JSON.stringify(transport)).not.toContain("PRIVATE CONNECTION DETAIL");
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
    ["high", "reasoner"],
    ["max", "designer"],
  ] as const)("accepts complete billed usage when %s reasoning details are omitted", async (reasoningEffort, role) => {
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 40,
      total_tokens: 140,
      prompt_tokens_details: { cached_tokens: 30 },
    };
    const fetchImpl = vi.fn(async () => jsonResponse(successEnvelope(undefined, usage)));
    const result = await createClient({ apiKey: "key", fetchImpl }).request({ ...REQUEST, role, reasoningEffort });
    expect(result).toMatchObject({
      ok: true,
      attempts: 1,
      usage: { inputTokens: 100, cachedTokens: 30, outputTokens: 40, thinkingTokens: 0 },
    });
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

  it("honors an explicit single-attempt boundary", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(successEnvelope()));
    const result = await createClient({ apiKey: "key", fetchImpl, maxAttempts: 1 }).request(REQUEST);
    expect(result).toMatchObject({ ok: false, code: "http", attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
    expect(result).toMatchObject({ ok: false, code: "timeout", providerCategory: "timeout", attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(Object.keys(result).sort()).toEqual(["attempts", "code", "durationMs", "modelId", "ok", "providerCategory"].sort());
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
