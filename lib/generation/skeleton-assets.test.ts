import { describe, expect, it } from "vitest";
import { parse } from "node-html-parser";
import { COLORING_DIRECTION } from "@/lib/generation/creative-fixtures.test-support";
import { CreativeDirectionSchema, type SkeletonAdaptationPlan } from "@/lib/generation/creative-contracts";
import { buildSkeletonInventory } from "@/lib/generation/skeleton-inventory";
import { structureIsPreserved } from "@/lib/generation/structural-fingerprint";
import { type CuratedImage } from "@/lib/imagery/manifest";
import { rankSkeletonAssets, resolveSkeletonAssets } from "@/lib/generation/skeleton-assets";

const FIXTURE_IMAGES: CuratedImage[] = [
  { id: "classroom-photo", promptNum: 1, style: "education-photo", family: ["education"], alt: "Soft classroom children learning", src: { hero: "/classroom-hero.jpg", tablet: "/classroom-tablet.jpg", thumb: "/classroom-thumb.jpg" } },
  { id: "corporate-dashboard", promptNum: 2, style: "saas-dashboard", family: ["saas"], alt: "Dark corporate analytics dashboard", src: { hero: "/dashboard-hero.jpg", tablet: "/dashboard-tablet.jpg", thumb: "/dashboard-thumb.jpg" } },
  { id: "coloring-crayons", promptNum: 3, style: "hand-drawn-illustration", family: ["education"], alt: "Pastel crayons beside animal coloring pages", src: { hero: "/crayons-hero.jpg", tablet: "/crayons-tablet.jpg", thumb: "/crayons-thumb.jpg" } },
  { id: "friendly-animal-art", promptNum: 4, style: "hand-drawn-illustration", family: ["education"], alt: "Friendly pastel animal illustration for children", src: { hero: "/animals-hero.jpg", tablet: "/animals-tablet.jpg", thumb: "/animals-thumb.jpg" } },
];

const HTML = `<!doctype html><html><body><main><section><img src="/old-hero.jpg" srcset="/old-hero-small.jpg 400w" alt="Abstract artwork"></section><section><img src="/old-card.jpg" alt="Neutral drawing"></section></main></body></html>`;

function plan(assets: SkeletonAdaptationPlan["assets"]): SkeletonAdaptationPlan {
  return { schemaVersion: "skeleton-adaptation-plan/1.0", tokens: {}, cssOverride: [], assets };
}

describe("rankSkeletonAssets", () => {
  it("prefers compatible coloring illustrations and excludes forbidden subjects", () => {
    expect(rankSkeletonAssets({
      query: "soft storybook children coloring crayons friendly animals pastel",
      direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
      images: FIXTURE_IMAGES,
    })).toEqual(["coloring-crayons", "friendly-animal-art"]);
  });

  it("normalizes accents and snake case in subject matching", () => {
    const images: CuratedImage[] = [{ id: "cafe-art", promptNum: 5, style: "hand-drawn-illustration", family: [], alt: "Pastel cafe coloring illustration", src: { hero: "/cafe.jpg", tablet: "/cafe-tablet.jpg", thumb: "/cafe-thumb.jpg" } }];
    expect(rankSkeletonAssets({ query: "CAFÉ_coloring", direction: CreativeDirectionSchema.parse(COLORING_DIRECTION), images })).toEqual(["cafe-art"]);
  });

  it("breaks equal eligible catalog scores by image ID", () => {
    const images: CuratedImage[] = [
      { id: "zebra-art", promptNum: 5, style: "hand-drawn-illustration", family: [], alt: "Pastel zebra coloring illustration", src: { hero: "/z.jpg", tablet: "/z-t.jpg", thumb: "/z-s.jpg" } },
      { id: "ant-art", promptNum: 6, style: "hand-drawn-illustration", family: [], alt: "Pastel ant coloring illustration", src: { hero: "/a.jpg", tablet: "/a-t.jpg", thumb: "/a-s.jpg" } },
    ];
    expect(rankSkeletonAssets({ query: "coloring", direction: CreativeDirectionSchema.parse(COLORING_DIRECTION), images })).toEqual(["ant-art", "zebra-art"]);
  });

  it("does not admit an image solely because its tone matches the mode", () => {
    const images: CuratedImage[] = [{ id: "pastel-art", promptNum: 5, style: "hand-drawn-illustration", family: [], alt: "Pastel friendly illustration", src: { hero: "/pastel.jpg", tablet: "/pastel-tablet.jpg", thumb: "/pastel-thumb.jpg" } }];
    expect(rankSkeletonAssets({ query: "astronomy telescope", direction: CreativeDirectionSchema.parse(COLORING_DIRECTION), images })).toEqual([]);
  });

  it("uses exact normalized forbidden-token boundaries while preserving short avoid tokens", () => {
    const direction = CreativeDirectionSchema.parse({ ...COLORING_DIRECTION, imagery: { ...COLORING_DIRECTION.imagery, avoid: ["ai_ml"] } });
    const images: CuratedImage[] = [
      { id: "ai-ml-robot", promptNum: 5, style: "hand-drawn-illustration", family: [], alt: "Pastel robot coloring illustration", src: { hero: "/ai.jpg", tablet: "/ai-t.jpg", thumb: "/ai-s.jpg" } },
      { id: "aim-robot", promptNum: 6, style: "hand-drawn-illustration", family: [], alt: "Pastel robot coloring illustration", src: { hero: "/aim.jpg", tablet: "/aim-t.jpg", thumb: "/aim-s.jpg" } },
    ];
    expect(rankSkeletonAssets({ query: "robot coloring", direction, images })).toEqual(["aim-robot"]);
  });
});

describe("resolveSkeletonAssets", () => {
  it("changes only authorized content image attributes to catalog values", async () => {
    const inventory = buildSkeletonInventory(HTML, "coloring");
    const result = await resolveSkeletonAssets({
      html: HTML, inventory, direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
      plan: plan([{ slotIndex: 0, action: "replace", mediaType: "illustration", query: "animal coloring crayons", alt: "Friendly animals coloring together", required: true }]),
    }, { loadImages: async () => FIXTURE_IMAGES });

    expect(result).toMatchObject({ ok: true, applied: 1, assigned: [{ slotIndex: 0, imageId: "coloring-crayons" }] });
    if (!result.ok) return;
    const images = parse(result.html).querySelectorAll("img");
    expect(images[0].getAttribute("src")).toBe("/crayons-hero.jpg");
    expect(images[0].getAttribute("srcset")).toBe("/crayons-thumb.jpg 400w, /crayons-tablet.jpg 800w, /crayons-hero.jpg 1920w");
    expect(images[0].getAttribute("alt")).toBe("Friendly animals coloring together");
    expect(images[1].getAttribute("src")).toBe("/old-card.jpg");
    expect(images[1].getAttribute("alt")).toBe("Neutral drawing");
    expect(structureIsPreserved(HTML, result.html, { allowedAssetSlots: inventory.assetSlots.map((slot) => slot.slotIndex) })).toBe(true);
  });

  it("fails closed when an optional retained original contains short avoided terms", async () => {
    const aiHtml = HTML.replace("Neutral drawing", "AI ML generated drawing");
    const inventory = buildSkeletonInventory(aiHtml, "coloring");
    const direction = CreativeDirectionSchema.parse({ ...COLORING_DIRECTION, imagery: { ...COLORING_DIRECTION.imagery, avoid: ["ai_ml"] } });
    await expect(resolveSkeletonAssets({
      html: aiHtml, inventory, direction,
      plan: plan([{ slotIndex: 1, action: "replace", mediaType: "illustration", query: "unrelated astronomy telescope", alt: "Telescope", required: false }]),
    }, { loadImages: async () => FIXTURE_IMAGES })).resolves.toMatchObject({ ok: false, code: "required_asset_unavailable", slotIndex: 1 });
  });

  it("keeps inventory alignment for the first twelve body image slots", async () => {
    const manyImages = Array.from({ length: 13 }, (_, index) => `<img src="/old-${index}.jpg" alt="Drawing ${index}">`).join("");
    const html = `<!doctype html><html><head><template><img src="/head.jpg" alt="Head decoration"></template></head><body><main><section>${manyImages}</section></main></body></html>`;
    const inventory = buildSkeletonInventory(html, "many-images");
    const result = await resolveSkeletonAssets({
      html, inventory, direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
      plan: plan([{ slotIndex: 11, action: "replace", mediaType: "illustration", query: "animal coloring crayons", alt: "Crayons", required: true }]),
    }, { loadImages: async () => FIXTURE_IMAGES });
    expect(result).toMatchObject({ ok: true, assigned: [{ slotIndex: 11, imageId: "coloring-crayons" }] });
    if (!result.ok) return;
    const root = parse(result.html);
    expect(root.querySelector("head img")?.getAttribute("src")).toBe("/head.jpg");
    expect(root.querySelectorAll("body img")[11].getAttribute("src")).toBe("/crayons-hero.jpg");
    expect(root.querySelectorAll("body img")[12].getAttribute("src")).toBe("/old-12.jpg");
  });

  it("returns required_asset_unavailable for a required catalog miss", async () => {
    const inventory = buildSkeletonInventory(HTML, "coloring");
    await expect(resolveSkeletonAssets({
      html: HTML, inventory, direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
      plan: plan([{ slotIndex: 0, action: "replace", mediaType: "illustration", query: "unrelated astronomy telescope", alt: "Telescope", required: true }]),
    }, { loadImages: async () => FIXTURE_IMAGES })).resolves.toMatchObject({ ok: false, code: "required_asset_unavailable", slotIndex: 0 });
  });

  it("keeps an optional original only when it contains no forbidden signal", async () => {
    const inventory = buildSkeletonInventory(HTML, "coloring");
    const result = await resolveSkeletonAssets({
      html: HTML, inventory, direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
      plan: plan([{ slotIndex: 1, action: "replace", mediaType: "illustration", query: "unrelated astronomy telescope", alt: "Telescope", required: false }]),
    }, { loadImages: async () => FIXTURE_IMAGES });
    expect(result).toMatchObject({ ok: true, applied: 0, assigned: [] });
    if (result.ok) expect(parse(result.html).querySelectorAll("img")[1].getAttribute("src")).toBe("/old-card.jpg");
  });

  it("does not retain an optional original with a forbidden alt or style signal", async () => {
    const forbiddenHtml = HTML.replace('alt="Neutral drawing"', 'alt="Neutral drawing" style="corporate dashboard"');
    const inventory = buildSkeletonInventory(forbiddenHtml, "coloring");
    await expect(resolveSkeletonAssets({
      html: forbiddenHtml, inventory, direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
      plan: plan([{ slotIndex: 1, action: "replace", mediaType: "illustration", query: "unrelated astronomy telescope", alt: "Telescope", required: false }]),
    }, { loadImages: async () => FIXTURE_IMAGES })).resolves.toMatchObject({ ok: false, code: "required_asset_unavailable", slotIndex: 1 });
  });

  it("rejects a replacement instruction for an inventory slot not authorized as replaceable", async () => {
    const inventory = buildSkeletonInventory(HTML, "coloring");
    const lockedInventory = { ...inventory, assetSlots: inventory.assetSlots.map((slot) => slot.slotIndex === 0 ? { ...slot, replaceable: false } : slot) };
    await expect(resolveSkeletonAssets({
      html: HTML, inventory: lockedInventory, direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
      plan: plan([{ slotIndex: 0, action: "replace", mediaType: "illustration", query: "animal coloring crayons", alt: "Crayons", required: true }]),
    }, { loadImages: async () => FIXTURE_IMAGES })).resolves.toMatchObject({ ok: false, code: "asset_slot_unavailable", slotIndex: 0 });
  });

  it("does not reuse a catalog image across image slots", async () => {
    const inventory = buildSkeletonInventory(HTML, "coloring");
    const result = await resolveSkeletonAssets({
      html: HTML, inventory, direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
      plan: plan([
        { slotIndex: 0, action: "replace", mediaType: "illustration", query: "animal coloring crayons", alt: "Crayons", required: true },
        { slotIndex: 1, action: "replace", mediaType: "illustration", query: "friendly animal illustration", alt: "Animal", required: true },
      ]),
    }, { loadImages: async () => FIXTURE_IMAGES });
    expect(result).toMatchObject({ ok: true, assigned: [{ slotIndex: 0, imageId: "coloring-crayons" }, { slotIndex: 1, imageId: "friendly-animal-art" }] });
  });
});
