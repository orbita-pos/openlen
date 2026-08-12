import { describe, expect, it, vi } from "vitest";

import { createGeminiSectionSpecProvider } from "./gemini-section-spec-provider";

const spec = {
  schemaVersion: "generated-section-spec/1.0", role: "activities", layout: "grid",
  blocks: [{ kind: "heading", copyKey: "activities.title" }, { kind: "cards", copyKeys: ["activities.one", "activities.two"] }],
  geometry: { density: "balanced", emphasis: "copy" },
};
const request = {
  role: "activities" as const,
  intent: { domains: ["creative_play"], audiences: ["children"], requiredSignals: ["playful"], forbiddenSignals: ["dashboard"] },
  direction: { visualArchetype: "illustrated_activity_book", emotionalTone: ["playful"], density: "balanced" as const },
  copyKeys: ["activities.title", "activities.one", "activities.two"],
  assetSlots: [{ slotIndex: 2, mediaType: "illustration" as const }],
};
const envelope = (text: string, usage = { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 2, cachedContentTokenCount: 1 }) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: usage,
});

describe("Gemini section spec provider", () => {
  it("makes one allowlisted request without HTML, catalog, private metadata or copy values", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify(envelope(JSON.stringify(spec))), { status: 200 }));
    const result = await createGeminiSectionSpecProvider({ apiKey: "key", fetchImpl }).generate(request);
    expect(result).toMatchObject({ ok: true, spec, usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 2, cachedTokens: 1 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = String(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(body).toContain("activities.title");
    expect(body).not.toMatch(/<html|<section|template catalog|SECRET|private/i);
    expect(JSON.parse(body).generationConfig.responseSchema).toMatchObject({ type: "OBJECT", additionalProperties: false });
  });

  it("does not call HTTP without a key", async () => {
    const fetchImpl = vi.fn();
    await expect(createGeminiSectionSpecProvider({ env: { NODE_ENV: "test" }, fetchImpl }).generate(request))
      .resolves.toMatchObject({ ok: false, code: "missing_key" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies HTTP and non-JSON provider responses without body leakage", async () => {
    const http = createGeminiSectionSpecProvider({ apiKey: "key", fetchImpl: async () => new Response("SECRET", { status: 429 }) });
    const httpResult = await http.generate(request);
    expect(httpResult).toMatchObject({ ok: false, code: "http" });
    expect(httpResult).not.toHaveProperty("usage");
    const malformed = createGeminiSectionSpecProvider({ apiKey: "key", fetchImpl: async () => new Response("not-json", { status: 200 }) });
    await expect(malformed.generate(request)).resolves.toMatchObject({ ok: false, code: "provider" });
  });

  it.each([
    ["invalid_json", "{"],
    ["schema", JSON.stringify({ ...spec, html: "<section>bad</section>" })],
    ["future_version", JSON.stringify({ ...spec, schemaVersion: "generated-section-spec/2.0" })],
  ])("preserves safe usage on paid %s failures", async (code, text) => {
    const provider = createGeminiSectionSpecProvider({ apiKey: "key", fetchImpl: async () => new Response(JSON.stringify(envelope(text)), { status: 200 }) });
    await expect(provider.generate(request)).resolves.toMatchObject({ ok: false, code, usage: { inputTokens: 10, outputTokens: 5 } });
  });

  it("times out while parsing the response body and never retries", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) }) as Response);
    const provider = createGeminiSectionSpecProvider({ apiKey: "key", fetchImpl, timeoutMs: 5 });
    await expect(provider.generate(request)).resolves.toMatchObject({ ok: false, code: "timeout" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("trims a safe model ID and falls back from invalid IDs", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => { urls.push(String(url)); return new Response(JSON.stringify(envelope(JSON.stringify(spec))), { status: 200 }); };
    await createGeminiSectionSpecProvider({ apiKey: "key", modelId: "  gemini-safe_1  ", fetchImpl }).generate(request);
    await createGeminiSectionSpecProvider({ apiKey: "key", modelId: "../bad", fetchImpl }).generate(request);
    expect(urls[0]).toContain("/gemini-safe_1:generateContent");
    expect(urls[1]).toContain("/gemini-2.5-flash:generateContent");
  });
});
