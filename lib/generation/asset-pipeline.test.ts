import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/images", () => ({
  processImage: async ({ input, variants }: { input: Buffer; variants: Array<{ format: string }> }) => ({
    variants: variants.map((variant) => ({
      width: input.readUIntLE(24, 3) + 1,
      height: input.readUIntLE(27, 3) + 1,
      format: variant.format,
      mime: `image/${variant.format}`,
      bytes: input,
      size: input.length,
    })),
  }),
}));

import type { CuratedAssetPackResult } from "@/lib/generation/asset-catalog";
import {
  AssetManifestSchema,
  AssetResolutionTraceSchema,
  validateAssetManifestHash,
  type AssetIntent,
} from "@/lib/generation/asset-contracts";
import type { AssetPackProvider, AssetPackRequest, AssetPackResult } from "@/lib/generation/asset-pack-provider";
import { resolveDomainAssetManifest } from "@/lib/generation/asset-pipeline";
import { CreativeDirectionSchema } from "@/lib/generation/creative-contracts";
import { COLORING_DIRECTION } from "@/lib/generation/creative-fixtures.test-support";
import type { CuratedImage } from "@/lib/imagery/manifest";

function webp(width = 1200, height = 675): Buffer {
  const payload = Buffer.alloc(10);
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

const VALID_WEBP = webp();
const WEBP_HASH = createHash("sha256").update(VALID_WEBP).digest("hex");
const WEBP_CHECKSUM = `sha256:${WEBP_HASH}` as const;
const BUDGET = { version: "1", maxCostMicromxn: 10_000, estimatedImageCostMicromxn: 100 } as const;
const DIRECTION = CreativeDirectionSchema.parse(COLORING_DIRECTION);

function intent(slotIndex: number, overrides: Partial<AssetIntent> = {}): AssetIntent {
  return {
    slotIndex,
    role: slotIndex === 0 ? "hero" : "card",
    required: true,
    identityBearing: true,
    mediaType: "illustration",
    subjects: [slotIndex === 0 ? "coloring_pages" : "friendly_animals"],
    domains: ["children_entertainment"],
    audiences: ["children"],
    visualArchetype: "illustrated_creative_play",
    emotionalTone: ["playful"],
    aspectRatio: "16:9",
    focalPoint: "center",
    alt: slotIndex === 0 ? "Coloring pages and crayons" : "Friendly animals ready to color",
    requiredSignals: [],
    forbiddenSignals: ["corporate"],
    ...overrides,
  };
}

function curatedImage(slotIndex: number): CuratedImage {
  const subject = slotIndex === 0 ? "coloring_pages" : "friendly_animals";
  const url = `https://images.openlen.com/task4-${slotIndex}.webp`;
  return {
    id: `task4-${slotIndex}`,
    promptNum: slotIndex + 1,
    style: "storybook-crayon",
    family: ["children-entertainment"],
    alt: `Playful ${subject} illustration for children`,
    src: { hero: url, tablet: url, thumb: url },
    domains: ["children_entertainment"],
    audiences: ["children"],
    visualSignals: [subject, "playful", "friendly"],
    mediaType: "illustration",
    license: "openlen_catalog",
    checksum: WEBP_CHECKSUM,
  };
}

function curatedAssignment(slotIndex: number) {
  return {
    slotIndex,
    assetId: `curated-${slotIndex}`,
    url: `https://images.openlen.com/curated-${slotIndex}.webp`,
    styleLock: "storybook_crayon",
    score: 100,
    provenance: { catalogVersion: "catalog-1", license: "openlen_catalog" as const },
    mimeType: "image/webp" as const,
    ext: "webp" as const,
    width: 1200,
    height: 675,
    checksum: WEBP_CHECKSUM,
  };
}

function incompleteCurated(assignments: ReturnType<typeof curatedAssignment>[], unresolvedSlotIndexes: number[]): CuratedAssetPackResult {
  return {
    status: "incomplete",
    catalogVersion: "catalog-1",
    consistencyGroup: { mediaType: "illustration", artDirection: "soft_storybook_crayon", styleLock: "storybook_crayon" },
    assignments,
    unresolvedSlotIndexes,
    rejections: {
      wrong_domain: 0,
      wrong_audience: 0,
      wrong_media: 0,
      missing_required_signal: 0,
      forbidden_signal: 0,
      invalid_provenance: 0,
      untrusted_url: 0,
      wrong_aspect_ratio: 0,
      invalid_bytes: 0,
    },
  };
}

function provider(result: AssetPackResult) {
  const createPack = vi.fn<(request: AssetPackRequest) => Promise<AssetPackResult>>().mockResolvedValue(result);
  const value: AssetPackProvider = {
    capabilities: () => ({ generate: true, editFromReference: true, maxAssets: 3 }),
    createPack,
  };
  return { value, createPack };
}

function generatedSuccess(slots: number[]): AssetPackResult {
  return {
    ok: true,
    provider: "test_provider",
    modelId: "test-model",
    images: slots.map((slotIndex) => ({
      slotIndex,
      bytes: VALID_WEBP,
      mimeType: "image/webp",
      prompt: `Playful crayon illustration for slot ${slotIndex}`,
      promptSha256: `sha256:${createHash("sha256").update(`Playful crayon illustration for slot ${slotIndex}`).digest("hex")}`,
    })),
    usage: { inputTokens: 11, outputTokens: 22, cachedTokens: 3, thinkingTokens: 4 },
    estimatedCostMicromxn: slots.length * 100,
    durationMs: 25,
  };
}

function storage() {
  const put = vi.fn(async (_projectId: string, bytes: Buffer, ext: string, contentType: string) => ({
    filename: `${createHash("sha256").update(bytes).digest("hex")}.${ext}`,
    contentType,
    size: bytes.length,
    url: "https://backend-public.example/untrusted-and-ignored.webp",
  }));
  return { put };
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    loadCuratedImages: async () => [] as CuratedImage[],
    catalogVersion: "catalog-1",
    fetchImpl: async () => new Response(new Uint8Array(VALID_WEBP), { status: 200, headers: { "content-type": "image/webp", "content-length": String(VALID_WEBP.length) } }),
    provider: provider({ ok: false, code: "provider_unavailable", provider: "test_provider", modelId: "test-model", durationMs: 1 }).value,
    storage: storage(),
    budget: BUDGET,
    now: () => 100,
    ...overrides,
  };
}

function input(intents: AssetIntent[], mode: "curated" | "hybrid" = "hybrid") {
  return { intents, direction: DIRECTION, projectId: "kids-project", mode };
}

describe("resolveDomainAssetManifest", () => {
  it("uses a complete curated pack without calling provider or storage", async () => {
    const packProvider = provider(generatedSuccess([0, 1]));
    const assetStorage = storage();
    const result = await resolveDomainAssetManifest(input([intent(0), intent(1)]), deps({
      loadCuratedImages: async () => [curatedImage(0), curatedImage(1)],
      provider: packProvider.value,
      storage: assetStorage,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.slots.map((slot) => slot.resolution.source)).toEqual(["curated", "curated"]);
    expect(packProvider.createPack).not.toHaveBeenCalled();
    expect(assetStorage.put).not.toHaveBeenCalled();
  });

  it("asks the provider only for unresolved compatible slots after a partial curated result", async () => {
    const packProvider = provider(generatedSuccess([1]));
    const assetStorage = storage();
    const resolveCurated = vi.fn().mockResolvedValue(incompleteCurated([curatedAssignment(0)], [1]));
    const result = await resolveDomainAssetManifest(input([intent(0), intent(1)]), deps({
      resolveCurated,
      provider: packProvider.value,
      storage: assetStorage,
    }));

    expect(result.ok).toBe(true);
    expect(packProvider.createPack).toHaveBeenCalledTimes(1);
    expect(packProvider.createPack.mock.calls[0][0].assets.map((asset) => asset.slotIndex)).toEqual([1]);
    if (!result.ok) return;
    expect(result.manifest.slots.map((slot) => [slot.slotIndex, slot.resolution.source])).toEqual([[0, "curated"], [1, "generated"]]);
  });

  it("validates the complete provider pack before storage and emits only project-scoped generated URLs", async () => {
    const packProvider = provider(generatedSuccess([0, 1]));
    const assetStorage = storage();
    const result = await resolveDomainAssetManifest(input([intent(0), intent(1)]), deps({
      resolveCurated: async () => incompleteCurated([], [0, 1]),
      provider: packProvider.value,
      storage: assetStorage,
    }));

    expect(result.ok).toBe(true);
    expect(assetStorage.put).toHaveBeenCalledTimes(2);
    if (!result.ok) return;
    for (const slot of result.manifest.slots) {
      expect(slot.resolution.url).toBe(`/api/projects/kids-project/assets/${WEBP_HASH}.webp`);
      expect(slot.resolution.checksum).toBe(WEBP_CHECKSUM);
      expect(slot.resolution.width).toBe(1200);
      expect(slot.resolution.height).toBe(675);
    }
  });

  it("returns atomically on provider or storage failure without a success manifest", async () => {
    const providerFailure = provider({ ok: false, code: "provider_error", provider: "test_provider", modelId: "test-model", durationMs: 5 });
    const untouchedStorage = storage();
    const failedProvider = await resolveDomainAssetManifest(input([intent(0)]), deps({
      resolveCurated: async () => incompleteCurated([], [0]),
      provider: providerFailure.value,
      storage: untouchedStorage,
    }));
    expect(failedProvider).toMatchObject({ ok: false, code: "provider_error" });
    expect(untouchedStorage.put).not.toHaveBeenCalled();
    expect(failedProvider).not.toHaveProperty("manifest");

    const packProvider = provider(generatedSuccess([0, 1]));
    const put = vi.fn()
      .mockResolvedValueOnce({ filename: `${WEBP_HASH}.webp`, contentType: "image/webp", size: VALID_WEBP.length, url: "/ignored" })
      .mockRejectedValueOnce(new Error("storage down"));
    const failedStorage = await resolveDomainAssetManifest(input([intent(0), intent(1)]), deps({
      resolveCurated: async () => incompleteCurated([], [0, 1]),
      provider: packProvider.value,
      storage: { put },
    }));
    expect(failedStorage).toMatchObject({ ok: false, code: "storage_error" });
    expect(failedStorage).not.toHaveProperty("manifest");
  });

  it("validates every provider record before storing any bytes", async () => {
    const unsafePack = generatedSuccess([0, 1]);
    if (!unsafePack.ok) throw new Error("invalid_test_fixture");
    unsafePack.images[1].prompt = "<script>private response</script>";
    unsafePack.images[1].promptSha256 = `sha256:${createHash("sha256").update(unsafePack.images[1].prompt).digest("hex")}`;
    const packProvider = provider(unsafePack);
    const assetStorage = storage();

    const result = await resolveDomainAssetManifest(input([intent(0), intent(1)]), deps({
      resolveCurated: async () => incompleteCurated([], [0, 1]),
      provider: packProvider.value,
      storage: assetStorage,
    }));

    expect(result).toMatchObject({ ok: false, code: "invalid_asset" });
    expect(assetStorage.put).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("manifest");
  });

  it("validates the prospective manifest consistency group before storing mixed-media output", async () => {
    const packProvider = provider(generatedSuccess([0, 1]));
    const assetStorage = storage();
    const result = await resolveDomainAssetManifest(input([
      intent(0),
      intent(1, { mediaType: "photo" }),
    ]), deps({
      resolveCurated: async () => incompleteCurated([], [0, 1]),
      provider: packProvider.value,
      storage: assetStorage,
    }));

    expect(result).toMatchObject({ ok: false, code: "invalid_asset" });
    expect(assetStorage.put).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("manifest");
  });

  it.each([
    { label: "blank provider", mutate: (result: Record<string, unknown>) => { result.provider = ""; } },
    { label: "overlong model", mutate: (result: Record<string, unknown>) => { result.modelId = "m".repeat(97); } },
    { label: "private usage field", mutate: (result: Record<string, unknown>) => { result.usage = { inputTokens: 1, outputTokens: 2, cachedTokens: 0, thinkingTokens: 0, rawPrompt: "private" }; } },
    { label: "overflow usage", mutate: (result: Record<string, unknown>) => { result.usage = { inputTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 2, cachedTokens: 0, thinkingTokens: 0 }; } },
    { label: "negative cost", mutate: (result: Record<string, unknown>) => { result.estimatedCostMicromxn = -1; } },
    { label: "overflow cost", mutate: (result: Record<string, unknown>) => { result.estimatedCostMicromxn = Number.MAX_SAFE_INTEGER + 1; } },
    { label: "negative duration", mutate: (result: Record<string, unknown>) => { result.durationMs = -1; } },
    { label: "overflow duration", mutate: (result: Record<string, unknown>) => { result.durationMs = Number.MAX_SAFE_INTEGER + 1; } },
    { label: "private top-level field", mutate: (result: Record<string, unknown>) => { result.rawResponse = "private"; } },
  ])("typed-fails invalid $label telemetry before storage", async ({ mutate }) => {
    const unsafe = generatedSuccess([0]);
    if (!unsafe.ok) throw new Error("invalid_test_fixture");
    mutate(unsafe as unknown as Record<string, unknown>);
    const packProvider = provider(unsafe);
    const assetStorage = storage();

    const result = await resolveDomainAssetManifest(input([intent(0)]), deps({
      resolveCurated: async () => incompleteCurated([], [0]),
      provider: packProvider.value,
      storage: assetStorage,
    }));

    expect(result).toMatchObject({ ok: false, code: "invalid_asset" });
    expect(assetStorage.put).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("manifest");
  });

  it("typed-fails malformed provider failure telemetry without coercing its reason code", async () => {
    const malformedFailure = {
      ok: false,
      code: { toString: () => "provider_error" },
      provider: "test_provider",
      modelId: "test-model",
      durationMs: 1,
    } as unknown as AssetPackResult;
    const packProvider = provider(malformedFailure);
    const assetStorage = storage();

    const result = await resolveDomainAssetManifest(input([intent(0)]), deps({
      resolveCurated: async () => incompleteCurated([], [0]),
      provider: packProvider.value,
      storage: assetStorage,
    }));

    expect(result).toMatchObject({ ok: false, code: "invalid_asset" });
    expect(assetStorage.put).not.toHaveBeenCalled();
  });

  it("generates for an optional slot too, so an image nobody required can still exist", async () => {
    const optional = intent(0, { required: false, identityBearing: false });
    const packProvider = provider(generatedSuccess([0]));
    const result = await resolveDomainAssetManifest(input([optional]), deps({
      resolveCurated: async () => incompleteCurated([], [0]),
      provider: packProvider.value,
    }));

    // `required` used to decide both "the page fails without this" and "this is
    // worth paying for". The creative tool marks every request optional so a
    // missing image can never fail a page closed, which left it unable to ever
    // get one generated.
    expect(packProvider.createPack).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it("still ships the page with a placeholder when generating an optional image fails", async () => {
    const optional = intent(0, { required: false, identityBearing: false });
    const failing = provider({ ok: false, code: "provider_unavailable", provider: "gemini", modelId: "gemini-2.5-flash-image", durationMs: 5 } as never);
    const result = await resolveDomainAssetManifest(input([optional]), deps({
      resolveCurated: async () => incompleteCurated([], [0]),
      provider: failing.value,
    }));

    // Paying to try is the change; failing the page for an optional image is
    // not, and that distinction is the whole point of the split.
    expect(failing.createPack).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.slots[0].resolution).toMatchObject({ source: "placeholder" });
  });

  it("uses the repository-verified neutral placeholder only for optional non-identity slots", async () => {
    const optional = intent(0, { required: false, identityBearing: false });
    const result = await resolveDomainAssetManifest(input([optional], "curated"), deps({
      resolveCurated: async () => incompleteCurated([], [0]),
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.slots[0].resolution).toMatchObject({
      source: "placeholder",
      url: "/openlen-assets/placeholders/neutral-abstract.svg",
      provenance: { placeholderVersion: "neutral-abstract/1.0" },
    });
    const bytes = await readFile(path.join(process.cwd(), "public/openlen-assets/placeholders/neutral-abstract.svg"));
    expect(result.manifest.slots[0].resolution.checksum).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
  });

  it("fails closed when a required asset remains unresolved", async () => {
    const result = await resolveDomainAssetManifest(input([intent(0)], "curated"), deps({
      resolveCurated: async () => incompleteCurated([], [0]),
    }));

    expect(result).toMatchObject({ ok: false, code: "required_asset_unavailable", slotIndex: 0 });
    expect(result.trace.requiredUnresolvedCount).toBe(1);
    expect(result.trace.resultCode).toBe("required_asset_unavailable");
  });

  it("keeps curated and generated assignments in one immutable consistency group", async () => {
    const packProvider = provider(generatedSuccess([1, 2]));
    const result = await resolveDomainAssetManifest(input([intent(0), intent(1), intent(2)]), deps({
      resolveCurated: async () => incompleteCurated([curatedAssignment(0)], [1, 2]),
      provider: packProvider.value,
      storage: storage(),
    }));

    expect(result.ok).toBe(true);
    expect(packProvider.createPack).toHaveBeenCalledTimes(1);
    const requestedGroup = packProvider.createPack.mock.calls[0][0].consistencyGroup;
    if (!result.ok) return;
    expect(result.manifest.consistencyGroup).toEqual(requestedGroup);
    expect(new Set(result.manifest.slots.map((slot) => slot.intent.mediaType))).toEqual(new Set([requestedGroup.mediaType]));
  });

  it("returns a schema-valid canonical manifest and a strictly redacted trace", async () => {
    const packProvider = provider(generatedSuccess([1]));
    const result = await resolveDomainAssetManifest(input([intent(0), intent(1)]), deps({
      resolveCurated: async () => incompleteCurated([curatedAssignment(0)], [1]),
      provider: packProvider.value,
      storage: storage(),
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(AssetManifestSchema.parse(result.manifest)).toEqual(result.manifest);
    expect(validateAssetManifestHash(result.manifest)).toBe(true);
    expect(AssetResolutionTraceSchema.parse(result.trace)).toEqual(result.trace);
    expect(result.trace).toMatchObject({
      manifestId: result.manifest.manifestId,
      curatedCount: 1,
      generatedCount: 1,
      placeholderCount: 0,
      provider: "test_provider",
      modelId: "test-model",
      promptSha256: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
      usage: { inputTokens: 11, outputTokens: 22, cachedTokens: 3, thinkingTokens: 4 },
      estimatedCostMicromxn: 100,
      resultCode: "resolved",
    });
    expect(JSON.stringify(result.trace)).not.toContain("Playful crayon illustration");
    expect(JSON.stringify(result.trace)).not.toContain("RIFF");
  });
});
