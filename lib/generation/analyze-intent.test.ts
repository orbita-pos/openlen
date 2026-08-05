import { describe, expect, it, vi } from "vitest";

import { analyzeIntent } from "./analyze-intent";

const CHILDREN_INTENT = {
  schemaVersion: "intent-analysis/1.0",
  language: "es",
  functional: {
    siteType: "content_platform",
    requiredSections: ["coloring_gallery", "minigames", "stories"],
    primaryActions: ["start_coloring", "play", "read"],
    contentModel: "catalog",
  },
  audience: { primary: "children", ageRange: "5_10", secondary: ["parents"] },
  domains: ["children_entertainment", "creative_play"],
  emotionalGoals: ["playful", "magical", "safe"],
  requiredVisualSignals: ["coloring_page_preview", "child_friendly_illustration"],
  forbiddenVisualSignals: ["saas_dashboard", "course_progress_ui"],
  explicitConstraints: [],
  ambiguities: [],
  confidence: 0.93,
} as const;

function geminiResponse(text: string, status = 200): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 80 },
  }), { status, headers: { "content-type": "application/json" } });
}

describe("analyzeIntent", () => {
  it("sends separate functional and visual intent instructions with a native JSON schema", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return geminiResponse(JSON.stringify(CHILDREN_INTENT));
    });
    const now = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(125);

    const result = await analyzeIntent(
      "  Plataforma infantil de coloreo con cuentos y juegos  ",
      { apiKey: "secret key", modelId: "test-model", fetchImpl, now },
    );

    expect(result).toEqual({
      ok: true,
      intent: CHILDREN_INTENT,
      modelId: "test-model",
      promptVersion: "intent-prompt/1.0",
      usage: { inputTokens: 120, outputTokens: 80 },
      durationMs: 25,
    });
    expect(capturedUrl).toContain("/test-model:generateContent");
    expect(capturedUrl).not.toContain("secret key");
    expect(capturedUrl).not.toContain("secret%20key");
    expect(capturedBody).not.toBeNull();
    const body = capturedBody! as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ parts: Array<{ text: string }> }>;
      generationConfig: Record<string, unknown>;
    };
    expect(body.systemInstruction.parts[0].text).toContain("functional requirements");
    expect(body.systemInstruction.parts[0].text).toContain("visual and emotional identity");
    expect(body.systemInstruction.parts[0].text).toContain("forbiddenVisualSignals");
    expect(body.contents[0].parts[0].text).toContain(
      "Brief:\n\nPlataforma infantil de coloreo con cuentos y juegos",
    );
    expect(body.generationConfig).toMatchObject({
      temperature: 0.2,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    });
    expect(body.generationConfig.responseJsonSchema).toEqual(expect.objectContaining({
      type: "object",
      required: expect.arrayContaining([
        "functional",
        "audience",
        "domains",
        "requiredVisualSignals",
        "forbiddenVisualSignals",
      ]),
    }));
    const responseSchema = body.generationConfig.responseJsonSchema as {
      properties: {
        domains: Record<string, unknown>;
        functional: { properties: { requiredSections: Record<string, unknown> } };
        explicitConstraints: Record<string, unknown>;
        ambiguities: Record<string, unknown>;
      };
    };
    expect(responseSchema.properties.domains).toMatchObject({ minItems: 1, maxItems: 24 });
    expect(responseSchema.properties.functional.properties.requiredSections)
      .toMatchObject({ maxItems: 24 });
    expect(responseSchema.properties.explicitConstraints).toMatchObject({ maxItems: 12 });
    expect(responseSchema.properties.ambiguities).toMatchObject({ maxItems: 12 });
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("secret key");
  });

  it("does not call Gemini when the API key is missing", async () => {
    const fetchImpl = vi.fn();

    const result = await analyzeIntent("A complete product brief", {
      apiKey: "",
      fetchImpl,
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "missing_key" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an empty brief locally instead of buying an invented classification", async () => {
    const fetchImpl = vi.fn();

    const result = await analyzeIntent("   ", {
      apiKey: "",
      fetchImpl,
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a fixed API error without reflecting the provider response body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "provider secret detail" } }),
      { status: 429 },
    ));

    const result = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl,
      now: () => 10,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "api", message: "Gemini 429" },
    });
    expect(JSON.stringify(result)).not.toContain("provider secret detail");
  });

  it("reports malformed model JSON without inventing an intent", async () => {
    const result = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl: vi.fn().mockResolvedValue(geminiResponse("not-json")),
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "parse" } });
    expect(result).not.toHaveProperty("intent");
  });

  it("returns schema errors without inventing a fallback match", async () => {
    const result = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl: vi.fn().mockResolvedValue(geminiResponse(JSON.stringify({ confidence: 1 }))),
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "schema" } });
    expect(result).not.toHaveProperty("intent");
  });

  it("requires an explicit ambiguity and low confidence for unknown classifications", async () => {
    const unsafeUnknown = {
      ...CHILDREN_INTENT,
      functional: { ...CHILDREN_INTENT.functional, siteType: "unknown" },
      audience: { ...CHILDREN_INTENT.audience, primary: "unknown" },
      domains: ["unknown"],
      ambiguities: [],
      confidence: 0.9,
    };
    const safeUnknown = {
      ...unsafeUnknown,
      ambiguities: ["The brief does not identify a product category or audience."],
      confidence: 0.3,
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(geminiResponse(JSON.stringify(unsafeUnknown)))
      .mockResolvedValueOnce(geminiResponse(JSON.stringify(safeUnknown)));

    const rejected = await analyzeIntent("Make me a nice website", {
      apiKey: "x",
      fetchImpl,
      now: () => 10,
    });
    const accepted = await analyzeIntent("Make me a nice website", {
      apiKey: "x",
      fetchImpl,
      now: () => 10,
    });

    expect(rejected).toMatchObject({ ok: false, error: { kind: "schema" } });
    expect(accepted).toMatchObject({
      ok: true,
      intent: { domains: ["unknown"], confidence: 0.3 },
    });
  });

  it("does not start a request when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();

    const result = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      signal: controller.signal,
      fetchImpl,
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "aborted" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("honors caller cancellation while a request is pending", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));

    const pending = analyzeIntent("A complete product brief", {
      apiKey: "x",
      signal: controller.signal,
      fetchImpl,
      timeoutMs: 1_000,
      now: () => 10,
    });
    await Promise.resolve();
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { kind: "aborted" },
    });
  });

  it("times out a model request instead of leaving shadow selection pending", async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));

    const result = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl,
      timeoutMs: 5,
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });

  it("falls back from a non-finite timeout instead of scheduling an immediate timeout", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));
    const pending = analyzeIntent("A complete product brief", {
      apiKey: "x",
      signal: controller.signal,
      fetchImpl,
      timeoutMs: Number.POSITIVE_INFINITY,
      now: () => 10,
    });
    setTimeout(() => controller.abort(), 5);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { kind: "aborted" },
    });
  });

  it("maps network rejection and invalid envelopes to fixed API failures", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error("request https://example.test/?key=secret failed"))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{}] }), { status: 200 }));

    const network = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl,
      now: () => 10,
    });
    const invalidJson = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl,
      now: () => 10,
    });
    const missingParts = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl,
      now: () => 10,
    });

    expect(network).toMatchObject({
      ok: false,
      error: { kind: "api", message: "Gemini request failed" },
    });
    expect(JSON.stringify(network)).not.toContain("secret");
    expect(invalidJson).toMatchObject({
      ok: false,
      error: { kind: "api", message: "invalid Gemini response envelope" },
    });
    expect(missingParts).toMatchObject({
      ok: false,
      error: { kind: "api", message: "invalid Gemini response envelope" },
    });
  });
});
