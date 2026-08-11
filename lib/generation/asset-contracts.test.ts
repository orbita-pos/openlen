import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  AssetManifestSchema,
  AssetResolutionTraceSchema,
  validateAssetManifestHash,
} from "@/lib/generation/asset-contracts";

const HASH = `sha256:${"a".repeat(64)}`;

const COLORING_MANIFEST = {
  schemaVersion: "asset-manifest/1.0",
  manifestId: HASH,
  consistencyGroup: {
    id: "kids-coloring-pastel-01",
    mediaType: "illustration",
    artDirection: "soft_storybook_crayon",
    paletteHints: ["pastel_pink", "lavender"],
    styleLock: "rounded_shapes_hand_drawn_texture",
  },
  slots: [
    {
      slotIndex: 0,
      role: "hero",
      required: true,
      identityBearing: true,
      intent: {
        slotIndex: 0,
        role: "hero",
        required: true,
        identityBearing: true,
        mediaType: "illustration",
        subjects: ["children_coloring", "friendly_animals"],
        domains: ["education"],
        audiences: ["parents", "children"],
        visualArchetype: "illustrated_creative_play",
        emotionalTone: ["playful"],
        aspectRatio: "16:9",
        focalPoint: "center",
        alt: "Friendly animals ready to color",
        requiredSignals: ["playful"],
        forbiddenSignals: ["corporate"],
      },
      resolution: {
        source: "curated",
        slotIndex: 0,
        assetId: "coloring-crayons",
        url: "https://images.openlen.com/coloring-crayons.webp",
        mimeType: "image/webp",
        checksum: HASH,
        width: 1200,
        height: 675,
        domainMatch: true,
        audienceMatch: true,
        styleMatch: true,
        provenance: { catalogVersion: "openlen-images-1", license: "openlen_catalog" },
      },
    },
    {
      slotIndex: 1,
      role: "card",
      required: false,
      identityBearing: false,
      intent: {
        slotIndex: 1,
        role: "card",
        required: false,
        identityBearing: false,
        mediaType: "illustration",
        subjects: ["crayons"],
        domains: ["education"],
        audiences: ["parents"],
        visualArchetype: "illustrated_creative_play",
        emotionalTone: ["playful"],
        aspectRatio: "1:1",
        focalPoint: "center",
        alt: "Pastel crayons for coloring",
        requiredSignals: [],
        forbiddenSignals: ["corporate"],
      },
      resolution: {
        source: "placeholder",
        slotIndex: 1,
        assetId: "neutral-coloring-card",
        url: "/openlen-assets/neutral-coloring-card.svg",
        mimeType: "image/svg+xml",
        checksum: HASH,
        width: null,
        height: null,
        domainMatch: true,
        audienceMatch: true,
        styleMatch: true,
        provenance: { placeholderVersion: "neutral-abstract/1.0" },
      },
    },
  ],
  fallbackPolicy: "fail_closed_on_required_identity_asset",
};

function withUrl(manifest: typeof COLORING_MANIFEST, url: string) {
  const copy = structuredClone(manifest);
  copy.slots[0].resolution.url = url;
  return copy;
}

function withDuplicateSlot(manifest: typeof COLORING_MANIFEST) {
  const copy = structuredClone(manifest);
  copy.slots[1].slotIndex = 0;
  copy.slots[1].intent.slotIndex = 0;
  copy.slots[1].resolution.slotIndex = 0;
  return copy;
}

function withPlaceholderUrl(manifest: typeof COLORING_MANIFEST, url: string) {
  const copy = structuredClone(manifest);
  copy.slots[1].resolution.url = url;
  return copy;
}

function withGeneratedUrl(manifest: typeof COLORING_MANIFEST, url: string) {
  return {
    ...structuredClone(manifest),
    slots: [{
      ...manifest.slots[0],
      resolution: {
        source: "generated",
        slotIndex: 0,
        assetId: "generated-coloring-1",
        url,
        mimeType: "image/webp",
        checksum: HASH,
        width: 1200,
        height: 675,
        domainMatch: true,
        audienceMatch: true,
        styleMatch: true,
        provenance: { provider: "test", model: "test-model", requestVersion: "asset-pack-request/1.0", prompt: "friendly coloring animals", promptSha256: HASH },
      },
    }, manifest.slots[1]],
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

describe("AssetManifestSchema", () => {
  it("accepts a bounded children's-coloring manifest", () => {
    expect(AssetManifestSchema.parse(COLORING_MANIFEST).slots).toHaveLength(2);
  });

  it("fails closed for unknown keys, arbitrary URLs, and provider URLs", () => {
    expect(() => AssetManifestSchema.parse({ ...COLORING_MANIFEST, privateHtml: "<main>secret</main>" })).toThrow();
    expect(() => AssetManifestSchema.parse(withUrl(COLORING_MANIFEST, "https://evil.example/a.png"))).toThrow();
    expect(() => AssetManifestSchema.parse(withUrl(COLORING_MANIFEST, "https://provider.example/a.png"))).toThrow();
  });

  it("canonicalizes local asset paths and configured generated URLs", () => {
    expect(() => AssetManifestSchema.parse(withPlaceholderUrl(COLORING_MANIFEST, "/openlen-assets/../api/private.svg"))).toThrow();
    expect(() => AssetManifestSchema.parse(withPlaceholderUrl(COLORING_MANIFEST, "/openlen-assets/%2e%2e/api/private.svg"))).toThrow();

    const originalBaseUrl = process.env.OPENLEN_APP_BASE_URL;
    process.env.OPENLEN_APP_BASE_URL = "https://app.openlen.test";
    const assetPath = "/api/projects/kids/assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp";
    try {
      expect(AssetManifestSchema.parse(withGeneratedUrl(COLORING_MANIFEST, `https://app.openlen.test${assetPath}`)).slots[0].resolution.url).toBe(`https://app.openlen.test${assetPath}`);
      expect(() => AssetManifestSchema.parse(withGeneratedUrl(COLORING_MANIFEST, `https://user:pass@app.openlen.test${assetPath}`))).toThrow();
      expect(() => AssetManifestSchema.parse(withGeneratedUrl(COLORING_MANIFEST, `https://app.openlen.test${assetPath}?private=1`))).toThrow();
      expect(() => AssetManifestSchema.parse(withGeneratedUrl(COLORING_MANIFEST, `https://app.openlen.test${assetPath}#private`))).toThrow();
    } finally {
      if (originalBaseUrl === undefined) delete process.env.OPENLEN_APP_BASE_URL;
      else process.env.OPENLEN_APP_BASE_URL = originalBaseUrl;
    }
  });

  it("rejects mixed and double-encoded traversal before catalog URL normalization", () => {
    [
      "https://images.openlen.com/%2e./coloring.webp",
      "https://images.openlen.com/.%2e/coloring.webp",
      "https://images.openlen.com/%2E./coloring.webp",
      "https://images.openlen.com/.%2E/coloring.webp",
      "https://images.openlen.com/%252e%252e/coloring.webp",
      "https://images.openlen.com/%252E%252E/coloring.webp",
    ].forEach((url) => expect(() => AssetManifestSchema.parse(withUrl(COLORING_MANIFEST, url))).toThrow());
    expect(AssetManifestSchema.parse(withUrl(COLORING_MANIFEST, "https://images.openlen.com/coloring.v1.webp")).slots[0].resolution.url).toBe("https://images.openlen.com/coloring.v1.webp");
  });

  it("requires unique, aligned slot indexes and a single bounded pack", () => {
    expect(() => AssetManifestSchema.parse(withDuplicateSlot(COLORING_MANIFEST))).toThrow();
    expect(() => AssetManifestSchema.parse({ ...COLORING_MANIFEST, slots: Array.from({ length: 13 }, () => COLORING_MANIFEST.slots[0]) })).toThrow();
    expect(() => AssetManifestSchema.parse({
      ...COLORING_MANIFEST,
      consistencyGroup: { ...COLORING_MANIFEST.consistencyGroup, mediaType: "photo" },
    })).toThrow();
  });

  it("bounds generated records and protects unresolved required identity slots", () => {
    const generated = {
      ...COLORING_MANIFEST.slots[0],
      resolution: {
        source: "generated",
        slotIndex: 0,
        assetId: "generated-coloring-1",
        url: "/api/projects/kids/assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
        mimeType: "image/webp",
        checksum: HASH,
        width: 1200,
        height: 675,
        domainMatch: true,
        audienceMatch: true,
        styleMatch: true,
        provenance: { provider: "test", model: "test-model", requestVersion: "asset-pack-request/1.0", prompt: "friendly coloring animals", promptSha256: HASH },
      },
    };
    expect(() => AssetManifestSchema.parse({ ...COLORING_MANIFEST, slots: Array.from({ length: 4 }, (_, index) => ({ ...generated, slotIndex: index, intent: { ...generated.intent, slotIndex: index }, resolution: { ...generated.resolution, slotIndex: index, assetId: `generated-coloring-${index}` } })) })).toThrow();
    expect(() => AssetManifestSchema.parse({ ...COLORING_MANIFEST, slots: [{ ...COLORING_MANIFEST.slots[0], resolution: COLORING_MANIFEST.slots[1].resolution }] })).toThrow();
  });

  it("rejects unsafe or unbounded provenance and asset text", () => {
    expect(() => AssetManifestSchema.parse({ ...COLORING_MANIFEST, slots: [{ ...COLORING_MANIFEST.slots[0], resolution: { ...COLORING_MANIFEST.slots[0].resolution, checksum: "sha256:not-a-checksum" } }] })).toThrow();
    expect(() => AssetManifestSchema.parse({ ...COLORING_MANIFEST, slots: [{ ...COLORING_MANIFEST.slots[0], intent: { ...COLORING_MANIFEST.slots[0].intent, alt: "x".repeat(241) } }] })).toThrow();
    expect(() => AssetManifestSchema.parse({ ...COLORING_MANIFEST, slots: [{ ...COLORING_MANIFEST.slots[0], resolution: { ...COLORING_MANIFEST.slots[0].resolution, provenance: {} } }] })).toThrow();
  });

  it("checks canonical manifest hashes without trusting manifestId", () => {
    const { manifestId: _manifestId, ...unsignedManifest } = COLORING_MANIFEST;
    const canonical = canonicalJson(unsignedManifest);
    const manifest = { ...COLORING_MANIFEST, manifestId: `sha256:${createHash("sha256").update(canonical).digest("hex")}` };
    expect(validateAssetManifestHash(manifest)).toBe(true);
    expect(validateAssetManifestHash({ ...manifest, fallbackPolicy: "changed" })).toBe(false);
  });
});

describe("AssetResolutionTraceSchema", () => {
  it("keeps telemetry redacted to hashes", () => {
    expect(() => AssetResolutionTraceSchema.parse({ schemaVersion: "asset-resolution-trace/1.0", manifestId: HASH, consistencyGroupCount: 1, curatedCount: 1, generatedCount: 0, abstractCount: 0, placeholderCount: 0, requiredUnresolvedCount: 0, rejectionCounts: {}, provider: null, modelId: null, promptSha256: [], estimatedCostMicromxn: 0, durationMs: 1, resultCode: "resolved", prompt: "secret" })).toThrow();
  });

  it("never represents unresolved required assets as a successful result", () => {
    expect(() => AssetResolutionTraceSchema.parse({ schemaVersion: "asset-resolution-trace/1.0", manifestId: HASH, consistencyGroupCount: 0, curatedCount: 0, generatedCount: 0, abstractCount: 0, placeholderCount: 0, requiredUnresolvedCount: 1, rejectionCounts: { required_asset_unavailable: 1 }, provider: null, modelId: null, promptSha256: [], estimatedCostMicromxn: 0, durationMs: 1, resultCode: "resolved" })).toThrow();
  });

  it("uses a closed resolution result-code vocabulary", () => {
    const trace = { schemaVersion: "asset-resolution-trace/1.0", manifestId: HASH, consistencyGroupCount: 0, curatedCount: 0, generatedCount: 0, abstractCount: 0, placeholderCount: 0, requiredUnresolvedCount: 0, rejectionCounts: {}, provider: null, modelId: null, promptSha256: [], estimatedCostMicromxn: 0, durationMs: 1 } as const;
    expect(AssetResolutionTraceSchema.parse({ ...trace, resultCode: "resolved" }).resultCode).toBe("resolved");
    expect(() => AssetResolutionTraceSchema.parse({ ...trace, resultCode: "asset_pack_succeeded" })).toThrow();
    expect(() => AssetResolutionTraceSchema.parse({ ...trace, requiredUnresolvedCount: 1, resultCode: "asset_pack_succeeded" })).toThrow();
  });
});
