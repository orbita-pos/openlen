import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  parseAssetGenerationBudget,
  type AssetGenerationBudget,
  type AssetPackRequest,
} from "@/lib/generation/asset-pack-provider";
import { createGeminiAssetPackProvider } from "@/lib/generation/gemini-asset-pack-provider";
import type { AssetIntent, AssetManifest } from "@/lib/generation/asset-contracts";

const CONFIGURED_ENV = {
  NODE_ENV: "test",
  OPENLEN_VISUAL_ENGINE_ASSET_RATE_CARD_VERSION: "7",
  OPENLEN_VISUAL_ENGINE_ASSET_MAX_MICROMXN: "900",
  OPENLEN_VISUAL_ENGINE_ASSET_ESTIMATED_IMAGE_MICROMXN: "100",
} satisfies NodeJS.ProcessEnv;

const EMPTY_ENV = { NODE_ENV: "test" } satisfies NodeJS.ProcessEnv;

const BUDGET: AssetGenerationBudget = {
  version: "7",
  maxCostMicromxn: 900,
  estimatedImageCostMicromxn: 100,
};

function webp(width = 1200, height = 630, marker = 0): Buffer {
  const payload = Buffer.alloc(10);
  payload[0] = marker;
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUInt32LE(10, 16);
  payload.copy(bytes, 20);
  return bytes;
}

function intent(slotIndex: number, subject: string): AssetIntent {
  return {
    slotIndex,
    role: slotIndex === 0 ? "hero" : "section",
    required: true,
    identityBearing: true,
    mediaType: "illustration",
    subjects: [subject],
    domains: ["children_entertainment", "creative_play"],
    audiences: ["children"],
    visualArchetype: "playful_storybook",
    emotionalTone: ["magical", "friendly"],
    aspectRatio: "16:9",
    focalPoint: "center",
    alt: `PRIVATE CAMPAIGN COPY for ${subject}`,
    requiredSignals: ["crayons", "hand_drawn_texture"],
    forbiddenSignals: ["saas_dashboard", "corporate_photography"],
  };
}

const CONSISTENCY_GROUP: AssetManifest["consistencyGroup"] = {
  id: "kids-coloring-pastel-01",
  mediaType: "illustration",
  artDirection: "soft_storybook_crayon",
  paletteHints: ["pastel_pink", "lavender", "warm_yellow"],
  styleLock: "rounded_shapes_hand_drawn_texture",
};

function request(assets: readonly AssetIntent[] = [intent(0, "children_coloring")]): AssetPackRequest {
  return {
    schemaVersion: "asset-pack-request/1.0",
    consistencyGroup: CONSISTENCY_GROUP,
    assets,
    budget: BUDGET,
  };
}

function imageResponse(
  bytes: Buffer,
  mimeType = "image/webp",
  usageMetadata: Record<string, unknown> = {
    promptTokenCount: 11,
    candidatesTokenCount: 2,
    cachedContentTokenCount: 3,
    thoughtsTokenCount: 5,
  },
): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ inlineData: { mimeType, data: bytes.toString("base64") } }] } }],
    usageMetadata,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function provider(fetchImpl: typeof fetch, input: {
  env?: NodeJS.ProcessEnv;
  apiKey?: string;
  modelId?: string;
  timeoutMs?: number;
} = {}) {
  return createGeminiAssetPackProvider({
    apiKey: input.apiKey ?? "synthetic-key",
    env: input.env ?? CONFIGURED_ENV,
    fetchImpl,
    modelId: input.modelId,
    timeoutMs: input.timeoutMs,
  });
}

function parsedBody(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("parseAssetGenerationBudget", () => {
  it("returns null when any required budget variable is missing", () => {
    expect(parseAssetGenerationBudget(EMPTY_ENV)).toBeNull();
    expect(parseAssetGenerationBudget({
      ...EMPTY_ENV,
      OPENLEN_VISUAL_ENGINE_ASSET_RATE_CARD_VERSION: "7",
      OPENLEN_VISUAL_ENGINE_ASSET_MAX_MICROMXN: "900",
    })).toBeNull();
  });

  it.each(["", "0", "-1", "+1", "01", "1.5", " 1", "9007199254740992"])(
    "rejects malformed present exact-positive-integer value %j",
    (value) => {
      expect(() => parseAssetGenerationBudget({
        ...CONFIGURED_ENV,
        OPENLEN_VISUAL_ENGINE_ASSET_ESTIMATED_IMAGE_MICROMXN: value,
      })).toThrow("invalid_asset_generation_budget");
    },
  );

  it("parses an exact operational rate-card budget without provider pricing defaults", () => {
    expect(parseAssetGenerationBudget(CONFIGURED_ENV)).toEqual(BUDGET);
  });
});

describe("createGeminiAssetPackProvider request policy", () => {
  it("uses text only for the first slot and only the first validated image as later visual reference", async () => {
    const first = webp(1200, 630, 1);
    const second = webp(1200, 630, 2);
    const third = webp(1200, 630, 3);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(imageResponse(first))
      .mockResolvedValueOnce(imageResponse(second))
      .mockResolvedValueOnce(imageResponse(third));

    const result = await provider(fetchImpl).createPack(request([
      intent(0, "children_coloring"),
      intent(1, "friendly_animals"),
      intent(2, "creative_activities"),
    ]));

    expect(result).toMatchObject({ ok: true, estimatedCostMicromxn: 300 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const bodies = fetchImpl.mock.calls.map(parsedBody);
    const parts = bodies.map((body) => ((body.contents as Array<{ parts: unknown[] }>)[0]?.parts ?? []));
    expect(parts[0]).toEqual([expect.objectContaining({ text: expect.any(String) })]);
    expect(parts[1]).toEqual([
      { inlineData: { mimeType: "image/webp", data: first.toString("base64") } },
      expect.objectContaining({ text: expect.any(String) }),
    ]);
    expect(parts[2]).toEqual([
      { inlineData: { mimeType: "image/webp", data: first.toString("base64") } },
      expect.objectContaining({ text: expect.any(String) }),
    ]);
    expect(JSON.stringify(parts[2])).not.toContain(second.toString("base64"));
    for (const body of bodies) {
      expect(body.generationConfig).toEqual({ responseModalities: ["IMAGE"] });
      const prompt = JSON.stringify(body);
      expect(prompt).toContain("soft_storybook_crayon");
      expect(prompt).toContain("pastel_pink, lavender, warm_yellow");
      expect(prompt).toContain("rounded_shapes_hand_drawn_texture");
    }
  });

  it("sends only allowlisted bounded intent fields and keeps copy, secrets, URLs, and HTML out of the provider body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse(webp()));
    const result = await provider(fetchImpl).createPack(request());

    expect(result.ok).toBe(true);
    const body = parsedBody(fetchImpl.mock.calls[0] ?? []);
    expect(Object.keys(body).sort()).toEqual(["contents", "generationConfig"]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("PRIVATE CAMPAIGN COPY");
    expect(serialized).not.toContain("synthetic-key");
    expect(serialized).not.toMatch(/<\/?[a-z]|https?:|data:|javascript:/i);
    expect(serialized.length).toBeLessThan(4_000);
  });

  it("rejects unknown request fields before transport", async () => {
    const fetchImpl = vi.fn();
    const invalid = { ...request(), rawHtml: "<main>secret</main>" } as unknown as AssetPackRequest;

    await expect(provider(fetchImpl).createPack(invalid)).resolves.toMatchObject({
      ok: false,
      code: "invalid_provider_response",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caps packs at three slots before transport", async () => {
    const fetchImpl = vi.fn();
    const result = await provider(fetchImpl).createPack(request([
      intent(0, "one"), intent(1, "two"), intent(2, "three"), intent(3, "four"),
    ]));

    expect(result).toMatchObject({ ok: false, code: "invalid_provider_response" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the asset model override before image-edit and default model fallbacks", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse(webp()));
    const env = {
      ...CONFIGURED_ENV,
      OPENLEN_ASSET_IMAGE_MODEL: "asset-model",
      OPENLEN_IMAGE_EDIT_MODEL: "edit-model",
    };
    const result = await provider(fetchImpl, { env }).createPack(request());

    expect(result).toMatchObject({ ok: true, modelId: "asset-model" });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/asset-model:generateContent");
  });

  it.each([
    {
      label: "blank asset-model value",
      env: { ...CONFIGURED_ENV, OPENLEN_ASSET_IMAGE_MODEL: "   ", OPENLEN_IMAGE_EDIT_MODEL: "  edit-model  " },
      expected: "edit-model",
    },
    {
      label: "blank asset and image-edit values",
      env: { ...CONFIGURED_ENV, OPENLEN_ASSET_IMAGE_MODEL: " ", OPENLEN_IMAGE_EDIT_MODEL: "\t" },
      expected: "gemini-2.5-flash-image",
    },
    {
      label: "unbounded or URL-like values",
      env: {
        ...CONFIGURED_ENV,
        OPENLEN_ASSET_IMAGE_MODEL: `x${"a".repeat(96)}`,
        OPENLEN_IMAGE_EDIT_MODEL: "https://provider.invalid/model",
      },
      expected: "gemini-2.5-flash-image",
    },
  ])("selects the first trimmed bounded model identifier after $label", async ({ env, expected }) => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse(webp()));
    const result = await provider(fetchImpl, { env }).createPack(request());

    expect(result).toMatchObject({ ok: true, modelId: expected });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(`/${expected}:generateContent`);
  });
});

describe("createGeminiAssetPackProvider failure atomicity", () => {
  it("aborts on the first failed slot without retrying or returning a partial pack", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(imageResponse(webp(1200, 630, 1)))
      .mockResolvedValueOnce(new Response("synthetic failure", { status: 503 }));
    const result = await provider(fetchImpl).createPack(request([
      intent(0, "children_coloring"),
      intent(1, "friendly_animals"),
      intent(2, "creative_activities"),
    ]));

    expect(result).toMatchObject({ ok: false, code: "provider_error" });
    expect(result).not.toHaveProperty("images");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      label: "provider URL",
      payload: { candidates: [{ content: { parts: [{ fileData: { fileUri: "https://provider.invalid/image.webp", mimeType: "image/webp" } }] } }] },
      code: "invalid_provider_response",
    },
    {
      label: "text only",
      payload: { candidates: [{ content: { parts: [{ text: "I cannot create that image." }] } }] },
      code: "invalid_provider_response",
    },
    {
      label: "blocked prompt",
      payload: { promptFeedback: { blockReason: "SAFETY" }, candidates: [] },
      code: "provider_blocked",
    },
  ])("maps $label output to $code", async ({ payload, code }) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    await expect(provider(fetchImpl).createPack(request())).resolves.toMatchObject({ ok: false, code });
  });

  it("maps network failures and timeouts to distinct typed failures", async () => {
    const network = vi.fn().mockRejectedValue(new Error("private network detail"));
    await expect(provider(network).createPack(request())).resolves.toMatchObject({
      ok: false,
      code: "provider_error",
    });

    const hanging = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    await expect(provider(hanging, { timeoutMs: 5 }).createPack(request())).resolves.toMatchObject({
      ok: false,
      code: "provider_timeout",
    });
  });

  it("keeps the timeout active through a response body that never resolves", async () => {
    const never = new Promise<unknown>(() => undefined);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => never,
    } as Response);
    const work = provider(fetchImpl, { timeoutMs: 5 }).createPack(request());
    const result = await Promise.race([
      work,
      new Promise<"test_watchdog">((resolve) => setTimeout(() => resolve("test_watchdog"), 100)),
    ]);

    expect(result).toMatchObject({ ok: false, code: "provider_timeout" });
    expect(result).not.toHaveProperty("images");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid image bytes while preserving safe usage from the paid response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse(Buffer.from("not an image")));
    const result = await provider(fetchImpl).createPack(request());

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_image",
      usage: { inputTokens: 11, outputTokens: 2, cachedTokens: 3, thinkingTokens: 5 },
    });
  });

  it("preserves safe usage from a paid malformed response without exposing its body", async () => {
    const payload = {
      candidates: [{ unexpected: "private provider body" }],
      usageMetadata: {
        promptTokenCount: 21,
        candidatesTokenCount: 4,
        cachedContentTokenCount: 2,
        thoughtsTokenCount: 1,
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const result = await provider(fetchImpl).createPack(request());

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: "invalid_provider_response",
      usage: { inputTokens: 21, outputTokens: 4, cachedTokens: 2, thinkingTokens: 1 },
    }));
    expect(JSON.stringify(result)).not.toContain("private provider body");
  });
});

describe("createGeminiAssetPackProvider operational gates", () => {
  it("disables generation before transport when the API key or budget configuration is missing or malformed", async () => {
    for (const options of [
      { apiKey: "", env: CONFIGURED_ENV },
      { apiKey: "synthetic-key", env: EMPTY_ENV },
      {
        apiKey: "synthetic-key",
        env: { ...CONFIGURED_ENV, OPENLEN_VISUAL_ENGINE_ASSET_MAX_MICROMXN: "1.5" },
      },
    ]) {
      const fetchImpl = vi.fn();
      const instance = provider(fetchImpl, options);
      expect(instance.capabilities().generate).toBe(false);
      await expect(instance.createPack(request())).resolves.toMatchObject({
        ok: false,
        code: "provider_unavailable",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("makes zero calls when the estimated pack cost exceeds the operational cap", async () => {
    const fetchImpl = vi.fn();
    const overCapRequest = request([intent(0, "one"), intent(1, "two")]);
    overCapRequest.budget = { ...BUDGET, maxCostMicromxn: 199 };

    const result = await provider(fetchImpl, {
      env: {
        ...CONFIGURED_ENV,
        OPENLEN_VISUAL_ENGINE_ASSET_MAX_MICROMXN: "199",
      },
    }).createPack(overCapRequest);

    expect(result).toMatchObject({ ok: false, code: "budget_exhausted" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns verified prompts, hashes, bytes, and aggregated usage for a successful pack", async () => {
    const bytesA = webp(1200, 630, 1);
    const bytesB = webp(1200, 630, 2);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(imageResponse(bytesA))
      .mockResolvedValueOnce(imageResponse(bytesB));
    const result = await provider(fetchImpl).createPack(request([
      intent(4, "children_coloring"), intent(9, "friendly_animals"),
    ]));

    expect(result).toMatchObject({
      ok: true,
      provider: "google_gemini",
      images: [
        { slotIndex: 4, bytes: bytesA, mimeType: "image/webp" },
        { slotIndex: 9, bytes: bytesB, mimeType: "image/webp" },
      ],
      usage: { inputTokens: 22, outputTokens: 4, cachedTokens: 6, thinkingTokens: 10 },
    });
    if (!result.ok) throw new Error("expected success");
    for (const image of result.images) {
      expect(image.prompt.length).toBeLessThanOrEqual(1_200);
      expect(image.promptSha256).toBe(`sha256:${createHash("sha256").update(image.prompt).digest("hex")}`);
    }
  });
});
