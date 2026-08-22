import { describe, expect, it, vi } from "vitest";

import { analyzeIntent, INTENT_PROMPT_VERSION } from "./analyze-intent";
import {
  CANONICAL_PRIMARY_AUDIENCES,
  CANONICAL_SECTION_ROLES,
  CANONICAL_SITE_TYPES,
} from "./structural-taxonomy";

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

// Sobre de OpenAI: el brief lo lee DeepSeek por el endpoint compatible de
// Fireworks (2026-08-21). Antes era el de Gemini —`candidates[0].content.parts`
// y `usageMetadata`— y el nombre de esta función lo decía.
function modelResponse(
  text: string,
  status = 200,
  usageMetadata: unknown = {
    prompt_tokens: 120,
    completion_tokens: 80,
    prompt_tokens_details: { cached_tokens: 20 },
    completion_tokens_details: { reasoning_tokens: 0 },
  },
): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: text } }],
    ...(usageMetadata === null ? {} : { usage: usageMetadata }),
  }), { status, headers: { "content-type": "application/json" } });
}

describe("analyzeIntent", () => {
  it("requests JSON without sending the provider a complex schema", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return modelResponse(JSON.stringify(CHILDREN_INTENT));
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
      promptVersion: "intent-prompt/1.8",
      usage: { inputTokens: 120, outputTokens: 80, cachedTokens: 20, thinkingTokens: 0 },
      durationMs: 25,
    });
    expect(capturedUrl).toContain("api.fireworks.ai");
    expect(capturedUrl).not.toContain("secret key");
    expect(capturedUrl).not.toContain("secret%20key");
    expect(capturedBody).not.toBeNull();
    const body = capturedBody! as {
      messages: Array<{ role: string; content: string }>;
      temperature: number;
      max_tokens: number;
      response_format: Record<string, unknown>;
    };
    expect(body.messages[0].content).toContain("functional requirements");
    expect(body.messages[0].content).toContain("visual and emotional identity");
    expect(body.messages[0].content).toContain("forbiddenVisualSignals");
    expect(body.messages[0].content)
      .toContain("children_entertainment, creative_play");
    expect(body.messages[0].content)
      .toContain("Primary audience must use one of these broad canonical labels");
    expect(body.messages[0].content)
      .toContain("saas_dashboard, course_progress_ui");
    expect(body.messages[0].content)
      .toContain("food_beverage retail or coffee -> saas_dashboard + medical_clinical");
    expect(body.messages[0].content)
      .toContain("return exactly those 2 profile signals");
    expect(body.messages[0].content)
      .toContain("restaurant or hospitality for the public -> consumers");
    expect(body.messages[0].content)
      .toContain("wellness classes or retreats for adults -> adults");
    expect(body.messages[0].content)
      .toContain("real-estate listings or brokerage -> home_buyers");
    expect(body.messages[0].content)
      .toContain("preschool -> education + local_services");
    expect(body.messages[0].content)
      .toContain("legal_services, logistics, business_services, science, music, photography, coworking, government, events, beauty, construction");
    expect(body.messages[0].content)
      .toContain("citizens, homeowners");
    expect(body.messages[0].content)
      .toContain("local_services applies to a place-based or appointment-based provider");
    expect(body.messages[0].content)
      .toContain("portfolio applies to an individual creator");
    expect(body.messages[0].content).toContain(CANONICAL_SITE_TYPES.join(", "));
    expect(body.messages[0].content).toContain(CANONICAL_PRIMARY_AUDIENCES.join(", "));
    expect(body.messages[0].content).toContain(CANONICAL_SECTION_ROLES.join(", "));
    expect(body.messages[0].content)
      .toContain("stories and testimonials are different roles");
    expect(body.messages[0].content)
      .toContain("minigames and activities are different roles");
    expect(body.messages[0].content)
      .toContain('schemaVersion must be the exact literal string "intent-analysis/1.0"');
    expect(body.messages[0].content)
      .toContain("functional.contentModel must be one lowercase snake_case string");
    expect(body.messages[0].content).toContain('"schemaVersion":"intent-analysis/1.0"');
    expect(body.messages[0].content)
      .toContain("public cafe, bakery, wine bar, taqueria, or restaurant -> restaurant");
    expect(body.messages[0].content)
      .toContain("appointment-based or membership-based local wellness studio -> small_business");
    expect(body.messages[0].content)
      .toContain("child-focused creative club -> children");
    expect(body.messages[0].content)
      .toContain("art educator creator hub -> educators");
    expect(body.messages[0].content)
      .toContain("issue archive with membership CTA -> blog");
    expect(body.messages[0].content)
      .toContain("signup-first publication without an issue archive -> newsletter");
    expect(INTENT_PROMPT_VERSION).toBe("intent-prompt/1.8");
    expect(body.messages[1].content).toContain(
      "Brief:\n\nPlataforma infantil de coloreo con cuentos y juegos",
    );
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(2048);
    // Se pide JSON, NO un esquema: el modo estricto de Fireworks rechaza
    // esquemas válidos (medido) y el validador de este módulo ya comprueba la
    // forma. Es lo mismo que decía la prueba antes, con la palabra de este wire.
    expect(body.response_format).toMatchObject({ type: "json_object" });
    expect(body.response_format).not.toHaveProperty("schema");
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer secret key");
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
      error: { kind: "api", message: "modelo 429" },
    });
    expect(JSON.stringify(result)).not.toContain("provider secret detail");
  });

  it("reports malformed model JSON without inventing an intent", async () => {
    const result = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl: vi.fn().mockResolvedValue(modelResponse("not-json")),
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "parse" } });
    expect(result).toMatchObject({
      usage: { inputTokens: 120, outputTokens: 80, cachedTokens: 20, thinkingTokens: 0 },
    });
    expect(result).not.toHaveProperty("intent");
  });

  it("returns schema errors without inventing a fallback match", async () => {
    const result = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl: vi.fn().mockResolvedValue(modelResponse(JSON.stringify({ confidence: 1 }))),
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "schema" } });
    expect(result).toMatchObject({
      usage: { inputTokens: 120, outputTokens: 80, cachedTokens: 20, thinkingTokens: 0 },
    });
    expect(result).not.toHaveProperty("intent");
  });

  it.each([
    ["site type", { functional: { ...CHILDREN_INTENT.functional, siteType: "learning_app" } }],
    ["primary audience", { audience: { ...CHILDREN_INTENT.audience, primary: "young_artists" } }],
    ["required section", { functional: { ...CHILDREN_INTENT.functional, requiredSections: ["hero", "lesson_dashboard"] } }],
  ])("rejects an out-of-vocabulary structural %s while preserving paid usage", async (_label, change) => {
    const result = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl: vi.fn().mockResolvedValue(modelResponse(JSON.stringify({
        ...CHILDREN_INTENT,
        ...change,
      }))),
      now: () => 10,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "schema" },
      usage: { inputTokens: 120, outputTokens: 80, cachedTokens: 20, thinkingTokens: 0 },
    });
    expect(result).not.toHaveProperty("intent");
  });

  it("keeps visual signals expressive when structural fields are canonical", async () => {
    const result = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl: vi.fn().mockResolvedValue(modelResponse(JSON.stringify({
        ...CHILDREN_INTENT,
        requiredVisualSignals: ["new_hand_cut_felt_collage"],
      }))),
      now: () => 10,
    });

    expect(result).toMatchObject({
      ok: true,
      intent: { requiredVisualSignals: ["new_hand_cut_felt_collage"] },
    });
  });

  it("preserves explicit zeroes in a complete provider usage envelope", async () => {
    const result = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl: vi.fn().mockResolvedValue(modelResponse(JSON.stringify(CHILDREN_INTENT), 200, {
        prompt_tokens: 0,
        completion_tokens: 0,
        prompt_tokens_details: { cached_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 0 },
      })),
      now: () => 10,
    });

    expect(result).toMatchObject({
      ok: true,
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thinkingTokens: 0 },
    });
  });

  it.each([
    ["cache and thoughts", { prompt_tokens: 10, completion_tokens: 2 }, 0, 0],
    ["thoughts", { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 3  }}, 3, 0],
    ["cache", { prompt_tokens: 10, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 4  }}, 0, 4],
  ])("treats omitted zero-value %s counters as zero", async (
    _label,
    usageMetadata,
    expectedCachedTokens,
    expectedThinkingTokens,
  ) => {
    const result = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl: vi.fn().mockResolvedValue(modelResponse(
        JSON.stringify(CHILDREN_INTENT),
        200,
        usageMetadata,
      )),
      now: () => 10,
    });

    expect(result).toMatchObject({
      ok: true,
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        cachedTokens: expectedCachedTokens,
        thinkingTokens: expectedThinkingTokens,
      },
    });
  });

  it.each([
    ["omitted", null],
    ["missing prompt", { completion_tokens: 2 }],
    ["missing completion", { prompt_tokens: 10 }],
    ["negative", { prompt_tokens: -1, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0  }}],
    ["fractional", { prompt_tokens: 1.5, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0  }}],
    ["string", { prompt_tokens: "1", completion_tokens: 2, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0  }}],
  ])("omits %s usage metadata instead of synthesizing token counts", async (_label, usageMetadata) => {
    const result = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl: vi.fn().mockResolvedValue(modelResponse(
        JSON.stringify(CHILDREN_INTENT),
        200,
        usageMetadata,
      )),
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: true });
    expect(result).not.toHaveProperty("usage");
  });

  it("preserves a valid usage envelope on a provider HTTP failure without exposing its body", async () => {
    const result = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        error: { message: "provider secret detail" },
        usage: {
          prompt_tokens: 7,
          completion_tokens: 1,
          prompt_tokens_details: { cached_tokens: 3 },
          completion_tokens_details: { reasoning_tokens: 2 },
        },
      }), { status: 429 })),
      now: () => 10,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "api", message: "modelo 429" },
      usage: { inputTokens: 7, outputTokens: 1, cachedTokens: 3, thinkingTokens: 2 },
    });
    expect(JSON.stringify(result)).not.toContain("provider secret detail");
  });

  it.each([
    ["invalid choices", { choices: {} }],
    ["missing message", { choices: [{}] }],
    ["invalid content", { choices: [{ message: { content: 42 } }] }],
  ])("omits paid usage from an HTTP-200 %s envelope", async (_label, candidateEnvelope) => {
    const result = await analyzeIntent("A complete product brief", {
      apiKey: "x",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        ...candidateEnvelope,
        usageMetadata: {
          prompt_tokens: 7,
          completion_tokens: 1,
          prompt_tokens_details: { cached_tokens: 3 },
          completion_tokens_details: { reasoning_tokens: 2 },
        },
      }), { status: 200 })),
      now: () => 10,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "api", message: "invalid model response envelope" },
    });
    expect(result).not.toHaveProperty("usage");
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
      .mockResolvedValueOnce(modelResponse(JSON.stringify(unsafeUnknown)))
      .mockResolvedValueOnce(modelResponse(JSON.stringify(safeUnknown)));

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
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{}] }), { status: 200 }));

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
      error: { kind: "api", message: "model request failed" },
    });
    expect(JSON.stringify(network)).not.toContain("secret");
    expect(invalidJson).toMatchObject({
      ok: false,
      error: { kind: "api", message: "invalid model response envelope" },
    });
    expect(missingParts).toMatchObject({
      ok: false,
      error: { kind: "api", message: "invalid model response envelope" },
    });
  });
});
