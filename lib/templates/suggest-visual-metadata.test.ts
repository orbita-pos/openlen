import { describe, expect, it, vi } from "vitest";
import { coerceSuggestedMetadata, suggestVisualMetadata } from "./suggest-visual-metadata";
import type { TemplateRecord } from "./store";

const MODEL_VALUE = {
  schemaVersion: "template-visual-metadata/1.0",
  domains: ["saas"], audiences: ["businesses"], ageRanges: [],
  emotionalRegisters: ["technical"], visualArchetypes: ["technical_minimal"],
  visualSignals: ["saas_dashboard"], layoutTraits: ["dense"],
  requiredAssetTypes: ["product_mockup"], negativeTags: ["children"],
  supportedSiteTypes: ["product_landing"], supportedSectionRoles: ["hero", "features", "footer"],
  themeability: "medium", identityStrength: "high", reviewStatus: "reviewed",
};

const TEMPLATE = {
  id: "mirror", name: "Mirror", family: "saas", pitch: "Dark SaaS",
  description: "Technical product page", screenshotUrl: "https://example.test/mirror.jpg",
} as TemplateRecord;

function geminiResponse(value: unknown = MODEL_VALUE): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
  }), { status: 200 });
}

describe("coerceSuggestedMetadata", () => {
  it("forces model suggestions to remain unreviewed", () => {
    const result = coerceSuggestedMetadata(MODEL_VALUE);
    expect(result?.reviewStatus).toBe("unreviewed");
  });

  it("returns null instead of accepting malformed model output", () => {
    expect(coerceSuggestedMetadata({ domains: ["saas"] })).toBeNull();
  });

  it("rejects a model suggestion with a missing schema version", () => {
    const { schemaVersion: _schemaVersion, ...withoutVersion } = MODEL_VALUE;
    expect(coerceSuggestedMetadata(withoutVersion)).toBeNull();
  });

  it("rejects a model suggestion with the wrong schema version", () => {
    expect(coerceSuggestedMetadata({ ...MODEL_VALUE, schemaVersion: "template-visual-metadata/2.0" })).toBeNull();
  });
});

it("sends the screenshot inline and keeps the suggestion unreviewed", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(MODEL_VALUE) }] } }],
    }), { status: 200 }));
  const result = await suggestVisualMetadata(TEMPLATE, { apiKey: "key", fetchImpl });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.metadata.reviewStatus).toBe("unreviewed");
  const request = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
  expect(request.contents[0].parts[1].inlineData.data).toBe("AQID");
});

describe("suggestVisualMetadata failure boundaries and audit", () => {
  it("returns typed input failures before making a request", async () => {
    const fetchImpl = vi.fn();
    const missingKey = await suggestVisualMetadata(TEMPLATE, { apiKey: "", fetchImpl });
    const missingScreenshot = await suggestVisualMetadata(
      { ...TEMPLATE, screenshotUrl: null },
      { apiKey: "key", fetchImpl },
    );
    expect(missingKey).toMatchObject({ ok: false, kind: "missing_key" });
    expect(missingScreenshot).toMatchObject({ ok: false, kind: "missing_screenshot" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records versioned provenance and normalizes an image MIME type", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "Image/PNG; charset=binary" },
      }))
      .mockResolvedValueOnce(geminiResponse());

    const result = await suggestVisualMetadata(TEMPLATE, {
      apiKey: "never-log-this-key",
      modelId: "gemini-test-model",
      fetchImpl,
    });

    expect(result).toMatchObject({
      ok: true,
      audit: {
        workflowVersion: "template-visual-metadata-suggestion-workflow/1.0",
        modelChoice: {
          version: "template-visual-metadata-model-choice/1.0",
          modelId: "gemini-test-model",
        },
        promptVersion: "template-visual-metadata-prompt/2.0",
        schemaVersion: "template-visual-metadata/1.0",
        generationConfig: {
          version: "template-visual-metadata-generation-config/2.0",
          temperature: 0.2,
          maxOutputTokens: 2_048,
          responseMimeType: "application/json",
          thinkingBudget: 0,
        },
        failurePolicy: {
          version: "template-visual-metadata-failure-policy/1.0",
          maximumFailureRate: 0.10,
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("never-log-this-key");
    const request = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
    expect(request.contents[0].parts[1].inlineData.mimeType).toBe("image/png");
    expect(request.contents[0].parts[0].text).toContain("ageRanges examples: 5_10, 18_24, 65_plus");
    expect(request.generationConfig.responseJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: [
        "schemaVersion", "domains", "audiences", "ageRanges", "emotionalRegisters",
        "visualArchetypes", "visualSignals", "layoutTraits", "requiredAssetTypes",
        "negativeTags", "supportedSiteTypes", "supportedSectionRoles", "themeability",
        "identityStrength", "reviewStatus",
      ],
      properties: {
        schemaVersion: { type: "string", enum: ["template-visual-metadata/1.0"] },
        domains: { type: "array", minItems: 1, maxItems: 40 },
        ageRanges: {
          type: "array",
          maxItems: 40,
          items: {
            type: "string",
            description: expect.stringContaining("5_10, 18_24, 65_plus"),
          },
        },
        themeability: { type: "string", enum: ["low", "medium", "high"] },
        identityStrength: { type: "string", enum: ["low", "medium", "high"] },
        reviewStatus: { type: "string", enum: ["unreviewed"] },
      },
    });
  });

  it("canonicalizes only pure numeric hyphenated age ranges before final validation", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }))
      .mockResolvedValueOnce(geminiResponse({ ...MODEL_VALUE, ageRanges: ["5-10", "18-24", "65_plus"] }));
    const result = await suggestVisualMetadata(TEMPLATE, { apiKey: "key", fetchImpl });
    expect(result).toMatchObject({
      ok: true,
      metadata: { ageRanges: ["5_10", "18_24", "65_plus"], reviewStatus: "unreviewed" },
    });
  });

  it.each(["18 - 24", "young-adults", "18-24-years"])(
    "does not normalize non-canonical age-range prose %s",
    async (ageRange) => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }))
        .mockResolvedValueOnce(geminiResponse({ ...MODEL_VALUE, ageRanges: [ageRange] }));
      const result = await suggestVisualMetadata(TEMPLATE, { apiKey: "key", fetchImpl });
      expect(result).toMatchObject({ ok: false, kind: "parse" });
    },
  );

  it("returns a typed fetch failure for a screenshot HTTP error", async () => {
    const result = await suggestVisualMetadata(TEMPLATE, {
      apiKey: "key",
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    });
    expect(result).toMatchObject({ ok: false, kind: "fetch", message: "screenshot 404" });
  });

  it("returns a typed model failure for a Gemini HTTP error", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const result = await suggestVisualMetadata(TEMPLATE, { apiKey: "key", fetchImpl });
    expect(result).toMatchObject({ ok: false, kind: "model", message: "Gemini 503" });
  });

  it("returns a typed fetch failure when the screenshot body cannot be read", async () => {
    const screenshot = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/jpeg" }),
      arrayBuffer: vi.fn().mockRejectedValue(new Error("body read failed")),
    } as unknown as Response;
    const result = await suggestVisualMetadata(TEMPLATE, {
      apiKey: "key",
      fetchImpl: vi.fn().mockResolvedValue(screenshot),
    });
    expect(result).toMatchObject({ ok: false, kind: "fetch", message: "screenshot body unreadable" });
  });

  it("returns a typed model failure when the Gemini envelope cannot be read", async () => {
    const modelResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new Error("body read failed")),
    } as unknown as Response;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }))
      .mockResolvedValueOnce(modelResponse);
    const result = await suggestVisualMetadata(TEMPLATE, { apiKey: "key", fetchImpl });
    expect(result).toMatchObject({ ok: false, kind: "model", message: "invalid Gemini response envelope" });
  });

  it("rejects a non-image screenshot response", async () => {
    const result = await suggestVisualMetadata(TEMPLATE, {
      apiKey: "key",
      fetchImpl: vi.fn().mockResolvedValue(new Response("not an image", {
        status: 200,
        headers: { "content-type": "text/html" },
      })),
    });
    expect(result).toMatchObject({ ok: false, kind: "fetch", message: "screenshot content type is not an image" });
  });

  it("uses image/jpeg when a screenshot response omits its MIME type", async () => {
    const screenshot = {
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    } as unknown as Response;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(screenshot)
      .mockResolvedValueOnce(geminiResponse());
    await suggestVisualMetadata(TEMPLATE, { apiKey: "key", fetchImpl });
    const request = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
    expect(request.contents[0].parts[1].inlineData.mimeType).toBe("image/jpeg");
  });

  it("returns a typed aborted result without starting a request", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();
    const result = await suggestVisualMetadata(TEMPLATE, {
      apiKey: "key",
      signal: controller.signal,
      fetchImpl,
    });
    expect(result).toMatchObject({ ok: false, kind: "aborted" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a typed aborted result when the caller cancels an active request", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const pending = suggestVisualMetadata(TEMPLATE, {
      apiKey: "key",
      signal: controller.signal,
      fetchImpl,
    });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ ok: false, kind: "aborted" });
  });

  it("returns a typed timeout when a template request does not settle", async () => {
    const fetchImpl = vi.fn().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const result = await suggestVisualMetadata(TEMPLATE, {
      apiKey: "key",
      timeoutMs: 5,
      fetchImpl,
    });
    expect(result).toMatchObject({ ok: false, kind: "timeout", message: "template suggestion timed out" });
  });

  it("preserves raw malformed model text as safe parse evidence", async () => {
    const raw = "```json\nnot json\n```";
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: raw }] } }],
      }), { status: 200 }));
    const result = await suggestVisualMetadata(TEMPLATE, { apiKey: "key", fetchImpl });
    expect(result).toMatchObject({ ok: false, kind: "parse", raw });
  });
});
