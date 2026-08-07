import { describe, expect, it, vi } from "vitest";

import { IntentAnalysisSchema } from "./contracts";
import { COLORING_DIRECTION, COLORING_INTENT, COLORING_PLAN } from "./creative-fixtures.test-support";
import {
  CREATIVE_PROMPT_VERSION,
  GeminiCreativeDirectionProvider,
  generateCreativeDirection,
  type CreativeDirectionRequest,
  type CreativeDirectionProvider,
} from "./generate-creative-direction";
import { buildSkeletonInventory } from "./skeleton-inventory";

const HTML = "<!doctype html><html><body><main><section class=\"hero\"><img src=\"/old.png\" alt=\"Abstract image\"></section></main></body></html>";

const REQUEST: CreativeDirectionRequest = {
  intent: IntentAnalysisSchema.parse(COLORING_INTENT),
  template: {
    domains: ["education"],
    audiences: ["parents"],
    visualSignals: ["friendly"],
    negativeTags: ["corporate"],
    themeability: "high" as const,
  },
  inventory: buildSkeletonInventory(HTML, "coloring-template"),
  brand: { accent: null },
};

const READY_RESPONSE = {
  schemaVersion: "skeleton-creative-response/1.0",
  status: "ready",
  direction: COLORING_DIRECTION,
  plan: COLORING_PLAN,
} as const;

function geminiResponse(text: string, status = 200, usageMetadata: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata,
  }), { status, headers: { "content-type": "application/json" } });
}

describe("generateCreativeDirection", () => {
  it("sends one strict JSON-only request without raw HTML and maps provider usage", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return geminiResponse(JSON.stringify(READY_RESPONSE), 200, {
        promptTokenCount: 120,
        candidatesTokenCount: 80,
        thoughtsTokenCount: 31.8,
        cachedContentTokenCount: -2,
      });
    });
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(125);

    const result = await generateCreativeDirection(REQUEST, {
      apiKey: "secret-key",
      fetchImpl,
      now,
    });

    expect(result).toEqual({
      ok: true,
      response: {
        schemaVersion: "skeleton-creative-response/1.0",
        status: "ready",
        creativeDirection: COLORING_DIRECTION,
        adaptationPlan: COLORING_PLAN,
      },
      modelId: "gemini-2.5-flash",
      promptVersion: CREATIVE_PROMPT_VERSION,
      usage: { inputTokens: 120, outputTokens: 80, thinkingTokens: 0, cachedTokens: 0 },
      durationMs: 25,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = capturedBody! as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ parts: Array<{ text: string }> }>;
      generationConfig: Record<string, unknown>;
    };
    expect(body.systemInstruction.parts).toHaveLength(1);
    expect(body.systemInstruction.parts[0].text).toContain("You do not generate HTML");
    expect(body.systemInstruction.parts[0].text).toContain("Never invent selectors, tokens, font URLs");
    expect(body.contents).toHaveLength(1);
    expect(JSON.parse(body.contents[0].parts[0].text)).toMatchObject({
      intent: COLORING_INTENT,
      template: REQUEST.template,
      inventory: REQUEST.inventory,
    });
    expect(body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      temperature: 0.2,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 512 },
    });
    expect(body.generationConfig).toHaveProperty("responseJsonSchema");
    const responseSchema = body.generationConfig.responseJsonSchema as {
      anyOf: Array<{ properties: { direction?: { properties: { palette: Record<string, unknown> } } } }>;
    };
    expect(responseSchema.anyOf[0]?.properties.direction?.properties.palette)
      .toMatchObject({ additionalProperties: false });
    expect(JSON.stringify(body)).not.toContain("<!doctype html>");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("clamps configured thinking budget and uses the configured model", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return geminiResponse(JSON.stringify(READY_RESPONSE));
    });

    const result = await generateCreativeDirection(REQUEST, {
      apiKey: "key",
      modelId: "visual-test-model",
      thinkingBudget: 9_999,
      fetchImpl,
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: true, modelId: "visual-test-model" });
    expect(capturedUrl).toContain("/visual-test-model:generateContent");
    expect((capturedBody!.generationConfig as { thinkingConfig: { thinkingBudget: number } })
      .thinkingConfig.thinkingBudget).toBe(2048);
  });

  it("allowlists the runtime payload before it reaches the provider", async () => {
    let providerPayload: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
      providerPayload = JSON.parse(body.contents[0]!.parts[0]!.text) as Record<string, unknown>;
      return geminiResponse(JSON.stringify(READY_RESPONSE));
    });
    const untrustedRuntimeRequest = {
      ...REQUEST,
      html: "<!doctype html><html><body>must-not-leak</body></html>",
      privateNotes: "must-not-leak-private-notes",
      intent: { ...REQUEST.intent, privateNotes: "must-not-leak-intent" },
      template: { ...REQUEST.template, internalReview: "must-not-leak-template" },
      inventory: { ...REQUEST.inventory, rawHtml: "<!doctype html>must-not-leak-inventory" },
      brand: { ...REQUEST.brand, secretBrandNote: "must-not-leak-brand" },
    } as CreativeDirectionRequest;

    await generateCreativeDirection(untrustedRuntimeRequest, { apiKey: "x", fetchImpl, now: () => 10 });

    expect(providerPayload).toEqual({
      intent: REQUEST.intent,
      template: REQUEST.template,
      inventory: REQUEST.inventory,
      brand: REQUEST.brand,
    });
    expect(JSON.stringify(providerPayload)).not.toContain("must-not-leak");
    expect(JSON.stringify(providerPayload)).not.toContain("<!doctype html>");
  });

  it("does not pass runtime extras to a replaceable provider", async () => {
    let receivedRequest: unknown;
    const provider: CreativeDirectionProvider = {
      generate: vi.fn(async (request) => {
        receivedRequest = request;
        return { text: JSON.stringify(READY_RESPONSE) };
      }),
    };
    const untrustedRuntimeRequest = {
      ...REQUEST,
      html: "<!doctype html><body>must-not-reach-provider</body>",
      privateNotes: "must-not-reach-provider-private",
      intent: { ...REQUEST.intent, privateNotes: "must-not-reach-provider-intent" },
      inventory: { ...REQUEST.inventory, rawHtml: "must-not-reach-provider-inventory" },
    } as CreativeDirectionRequest;

    await generateCreativeDirection(untrustedRuntimeRequest, { provider, now: () => 10 });

    expect(receivedRequest).toEqual(REQUEST);
    expect(JSON.stringify(receivedRequest)).not.toContain("must-not-reach-provider");
    expect(JSON.stringify(receivedRequest)).not.toContain("<!doctype html>");
  });

  it("returns redacted typed failures for local, provider, parser, contract, compatibility, and unexpected errors", async () => {
    const malformed = await generateCreativeDirection(REQUEST, { apiKey: "x", fetchImpl: vi.fn().mockResolvedValue(geminiResponse("```json\n{}\n```")), now: () => 10 });
    const schema = await generateCreativeDirection(REQUEST, { apiKey: "x", fetchImpl: vi.fn().mockResolvedValue(geminiResponse(JSON.stringify({ schemaVersion: "skeleton-creative-response/1.0", status: "ready" }))), now: () => 10 });
    const future = await generateCreativeDirection(REQUEST, { apiKey: "x", fetchImpl: vi.fn().mockResolvedValue(geminiResponse(JSON.stringify({ ...READY_RESPONSE, schemaVersion: "skeleton-creative-response/2.0" }))), now: () => 10 });
    const incompatible = await generateCreativeDirection(REQUEST, { apiKey: "x", fetchImpl: vi.fn().mockResolvedValue(geminiResponse(JSON.stringify({ schemaVersion: "skeleton-creative-response/1.0", status: "incompatible", reasonCode: "cannot_add_required_signal" }))), now: () => 10 });
    const http = await generateCreativeDirection(REQUEST, { apiKey: "x", fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "provider secret body" }), { status: 429 })), now: () => 10 });
    const unexpected = await generateCreativeDirection(REQUEST, {
      provider: { generate: vi.fn().mockRejectedValue(new Error("super-secret-url")) },
      now: () => 10,
    });
    const missingKey = await generateCreativeDirection(REQUEST, { apiKey: "", fetchImpl: vi.fn(), now: () => 10 });

    expect(malformed).toMatchObject({ ok: false, error: { kind: "invalid_json" } });
    expect(schema).toMatchObject({ ok: false, error: { kind: "schema" } });
    expect(future).toMatchObject({ ok: false, error: { kind: "future_version" } });
    expect(incompatible).toMatchObject({
      ok: true,
      response: { status: "incompatible", reasonCode: "cannot_add_required_signal" },
    });
    expect(http).toMatchObject({ ok: false, error: { kind: "http" } });
    expect(unexpected).toMatchObject({ ok: false, error: { kind: "unexpected" } });
    expect(missingKey).toMatchObject({ ok: false, error: { kind: "missing_key" } });
    for (const result of [malformed, schema, future, incompatible, http, unexpected, missingKey]) {
      expect(JSON.stringify(result)).not.toContain("provider secret body");
      expect(JSON.stringify(result)).not.toContain("super-secret-url");
      expect(JSON.stringify(result)).not.toContain("secret-key");
    }
  });

  it("propagates timeout and caller abort through the provider signal", async () => {
    let observedSignal: AbortSignal | undefined;
    const timeoutFetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const timedOut = await generateCreativeDirection(REQUEST, { apiKey: "x", fetchImpl: timeoutFetch, timeoutMs: 5, now: () => 10 });
    expect(timedOut).toMatchObject({ ok: false, error: { kind: "timeout" } });
    expect(observedSignal?.aborted).toBe(true);

    const controller = new AbortController();
    const pending = generateCreativeDirection(REQUEST, {
      apiKey: "x",
      fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
      signal: controller.signal,
      timeoutMs: 1_000,
      now: () => 10,
    });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: "aborted" } });
  });

  it("keeps orchestration independent of Gemini transport details", async () => {
    const provider: CreativeDirectionProvider = {
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify(READY_RESPONSE),
        usage: { inputTokens: 1, outputTokens: 2, thinkingTokens: 3, cachedTokens: 4 },
      }),
    };
    const result = await generateCreativeDirection(REQUEST, { provider, now: () => 10 });
    expect(result).toMatchObject({ ok: true, usage: { inputTokens: 1, outputTokens: 2, thinkingTokens: 3, cachedTokens: 4 } });
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it("exposes a Gemini adapter without requiring it in orchestration", () => {
    expect(new GeminiCreativeDirectionProvider({ apiKey: "x" })).toBeInstanceOf(GeminiCreativeDirectionProvider);
  });
});
