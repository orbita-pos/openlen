import { createHash } from "node:crypto";

import { parse } from "node-html-parser";
import { describe, expect, it } from "vitest";

import { applyAssetManifest } from "@/lib/generation/apply-asset-manifest";
import type { AssetIntent, AssetManifest } from "@/lib/generation/asset-contracts";
import { fingerprintStructure, structureIsPreserved } from "@/lib/generation/structural-fingerprint";

const HASH = `sha256:${"a".repeat(64)}` as const;
const HTML = `<!doctype html><html><head><style>.card{display:grid}</style></head><body>
<main><section><img src="/old-hero.webp" srcset="/old-hero-2x.webp 2x" alt="Old hero"><a href="/stories" data-track="stories">Stories</a></section>
<section><form action="/subscribe" method="post"><img src="/old-card.webp" alt="Old card"><input name="email"></form></section></main>
<script>window.ready = true;</script></body></html>`;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function intent(slotIndex: number): AssetIntent {
  return {
    slotIndex,
    role: slotIndex === 0 ? "hero" : "card",
    required: slotIndex === 0,
    identityBearing: slotIndex === 0,
    mediaType: "illustration",
    subjects: [slotIndex === 0 ? "coloring_pages" : "friendly_animals"],
    domains: ["children_entertainment"],
    audiences: ["children"],
    visualArchetype: "illustrated_creative_play",
    emotionalTone: ["playful"],
    aspectRatio: "16:9",
    focalPoint: "center",
    alt: slotIndex === 0 ? "Playful coloring pages" : "Friendly animals to color",
    requiredSignals: [],
    forbiddenSignals: ["corporate"],
  };
}

function manifest(slotIndexes: number[] = [0, 1]): AssetManifest {
  const unsigned = {
    schemaVersion: "asset-manifest/1.0" as const,
    consistencyGroup: {
      id: "kids-coloring-pack",
      mediaType: "illustration" as const,
      artDirection: "soft_storybook_crayon",
      paletteHints: ["pastel_pink"],
      styleLock: "rounded_hand_drawn",
    },
    slots: slotIndexes.map((slotIndex) => {
      const assetIntent = intent(slotIndex);
      return {
        slotIndex,
        role: assetIntent.role,
        required: assetIntent.required,
        identityBearing: assetIntent.identityBearing,
        intent: assetIntent,
        resolution: {
          source: "curated" as const,
          slotIndex,
          assetId: `coloring-${slotIndex}`,
          url: `https://images.openlen.com/coloring-${slotIndex}.webp`,
          mimeType: "image/webp" as const,
          checksum: HASH,
          width: 1200,
          height: 675,
          domainMatch: true as const,
          audienceMatch: true as const,
          styleMatch: true as const,
          provenance: { catalogVersion: "catalog-1", license: "openlen_catalog" as const },
        },
      };
    }),
    fallbackPolicy: "fail_closed_on_required_identity_asset" as const,
  };
  return {
    ...unsigned,
    manifestId: `sha256:${createHash("sha256").update(canonicalJson(unsigned)).digest("hex")}`,
  };
}

function sourceFingerprint(html = HTML, allowedAssetSlots: number[] = [0, 1]): string {
  return fingerprintStructure(html, { allowedAssetSlots });
}

describe("applyAssetManifest", () => {
  it("changes only src, existing srcset, and alt on exact replaceable slot indexes", () => {
    const result = applyAssetManifest({ html: HTML, manifest: manifest(), inputFingerprint: sourceFingerprint() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const before = parse(HTML);
    const after = parse(result.html);
    const images = after.querySelectorAll("img");
    expect(images[0].getAttribute("src")).toBe("https://images.openlen.com/coloring-0.webp");
    expect(images[0].getAttribute("srcset")).toBe("https://images.openlen.com/coloring-0.webp");
    expect(images[0].getAttribute("alt")).toBe("Playful coloring pages");
    expect(images[1].getAttribute("src")).toBe("https://images.openlen.com/coloring-1.webp");
    expect(images[1].hasAttribute("srcset")).toBe(false);
    expect(images[1].getAttribute("alt")).toBe("Friendly animals to color");
    expect(after.querySelector("script")?.toString()).toBe(before.querySelector("script")?.toString());
    expect(after.querySelector("style")?.toString()).toBe(before.querySelector("style")?.toString());
    expect(after.querySelector("form")?.attributes).toEqual(before.querySelector("form")?.attributes);
    expect(after.querySelector("a")?.getAttribute("href")).toBe("/stories");
    expect(after.querySelector("a")?.getAttribute("data-track")).toBe("stories");
    expect(structureIsPreserved(HTML, result.html, { allowedAssetSlots: [0, 1] })).toBe(true);
  });

  it("rejects a missing replaceable slot without returning HTML", () => {
    const result = applyAssetManifest({ html: HTML, manifest: manifest([2]), inputFingerprint: sourceFingerprint() });

    expect(result).toEqual({ ok: false, code: "asset_slot_unavailable" });
    expect(result).not.toHaveProperty("html");
  });

  it("rejects duplicate or multiple assignments for one slot", () => {
    const duplicate = structuredClone(manifest([0])) as AssetManifest;
    duplicate.slots.push(structuredClone(duplicate.slots[0]));

    const result = applyAssetManifest({ html: HTML, manifest: duplicate, inputFingerprint: sourceFingerprint() });

    expect(result).toEqual({ ok: false, code: "asset_slot_unavailable" });
    expect(result).not.toHaveProperty("html");
  });

  it("rejects a source fingerprint mismatch before applying assignments", () => {
    const result = applyAssetManifest({ html: HTML, manifest: manifest(), inputFingerprint: HASH });

    expect(result).toEqual({ ok: false, code: "structural_invariant_failed" });
    expect(result).not.toHaveProperty("html");
  });

  it("rejects a noncanonical or unsafe manifest without returning mutated HTML", () => {
    const tampered = structuredClone(manifest());
    tampered.slots[0].resolution.url = "https://evil.example/asset.webp";

    const result = applyAssetManifest({ html: HTML, manifest: tampered, inputFingerprint: sourceFingerprint() });

    expect(result).toEqual({ ok: false, code: "structural_invariant_failed" });
    expect(result).not.toHaveProperty("html");
  });

  it("uses only the first twelve inventory image slots for lookup and fingerprint exemptions", () => {
    const html = `<!doctype html><html><body><main>${Array.from(
      { length: 13 },
      (_, index) => `<section><img src="/old-${index}.webp" alt="Old image ${index}"></section>`,
    ).join("")}</main></body></html>`;
    const inventorySlots = Array.from({ length: 12 }, (_, index) => index);

    const authorized = applyAssetManifest({
      html,
      manifest: manifest([11]),
      inputFingerprint: sourceFingerprint(html, inventorySlots),
    });
    expect(authorized.ok).toBe(true);
    if (authorized.ok) {
      expect(parse(authorized.html).querySelectorAll("img")[11].getAttribute("src")).toBe("https://images.openlen.com/coloring-11.webp");
      expect(parse(authorized.html).querySelectorAll("img")[12].getAttribute("src")).toBe("/old-12.webp");
    }

    const outsideInventory = applyAssetManifest({
      html,
      manifest: manifest([12]),
      inputFingerprint: sourceFingerprint(html, inventorySlots),
    });
    expect(outsideInventory).toEqual({ ok: false, code: "asset_slot_unavailable" });
  });
});
