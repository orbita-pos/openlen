import { describe, expect, it } from "vitest";
import { searchCuratedPhotos } from "./photo-search";

// Shape mirrors public/openlen-images/manifest.json (verified against
// components/workspace-v2/replace-asset-modal.tsx's OpenLenManifest/OpenLenImage
// interfaces): { images: [{ id, style, alt, family, src: { hero, tablet, thumb } }] }
function img(over: Partial<{
  id: string;
  style: string;
  alt: string;
  family: string[];
  hero: string;
}> = {}) {
  return {
    id: over.id ?? "01-warm-glassy",
    promptNum: 1,
    style: over.style ?? "3d-abstract",
    family: over.family ?? ["saas", "portfolio"],
    alt: over.alt ?? "Three floating frosted glass forms in warm peach gradient",
    src: {
      hero: over.hero ?? "https://images.openlen.com/01-warm-glassy-1920.webp",
      tablet: "https://images.openlen.com/01-warm-glassy-800.webp",
      thumb: "https://images.openlen.com/01-warm-glassy-400.webp",
    },
  };
}

function manifest(images: ReturnType<typeof img>[]) {
  return { version: 1, generated: "2026-05-29T22:45:20.097Z", count: images.length, images };
}

describe("searchCuratedPhotos", () => {
  it("returns {url,style,alt} shaped from src.hero, style, alt", () => {
    const out = searchCuratedPhotos(manifest([img()]), {});
    expect(out).toEqual([
      {
        url: "https://images.openlen.com/01-warm-glassy-1920.webp",
        style: "3d-abstract",
        alt: "Three floating frosted glass forms in warm peach gradient",
      },
    ]);
  });

  it("filters by estilo (exact style match)", () => {
    const m = manifest([
      img({ id: "a", style: "3d-abstract" }),
      img({ id: "b", style: "claymorph" }),
      img({ id: "c", style: "claymorph" }),
    ]);
    const out = searchCuratedPhotos(m, { estilo: "claymorph" });
    expect(out).toHaveLength(2);
    expect(out.every((p) => p.style === "claymorph")).toBe(true);
  });

  it("estilo match is case-insensitive", () => {
    const m = manifest([img({ id: "a", style: "3d-abstract" })]);
    const out = searchCuratedPhotos(m, { estilo: "3D-ABSTRACT" });
    expect(out).toHaveLength(1);
  });

  it("estilo with no matches returns []", () => {
    const m = manifest([img({ style: "3d-abstract" })]);
    expect(searchCuratedPhotos(m, { estilo: "gaming-editorial" })).toEqual([]);
  });

  it("filters by término against alt/id/family, case+accent-insensitive", () => {
    const m = manifest([
      img({ id: "cafe-01", alt: "Café de especialidad en mesa de madera", family: ["restaurante"] }),
      img({ id: "gym-01", alt: "Pesas en gimnasio moderno", family: ["gym"] }),
    ]);
    // Query WITHOUT the accent must still match the accented alt text.
    const out = searchCuratedPhotos(m, { busqueda: "cafe" });
    expect(out).toHaveLength(1);
    expect(out[0].alt).toContain("Café");
  });

  it("término matches are case-insensitive too", () => {
    const m = manifest([img({ id: "gym-01", alt: "Pesas en gimnasio moderno" })]);
    expect(searchCuratedPhotos(m, { busqueda: "GIMNASIO" })).toHaveLength(1);
  });

  it("término matches against the id field", () => {
    const m = manifest([img({ id: "197-focus-pod", alt: "Something unrelated" })]);
    expect(searchCuratedPhotos(m, { busqueda: "focus-pod" })).toHaveLength(1);
  });

  it("término matches against family tags", () => {
    const m = manifest([img({ id: "x", alt: "y", family: ["ecommerce", "agency"] })]);
    expect(searchCuratedPhotos(m, { busqueda: "ecommerce" })).toHaveLength(1);
  });

  it("combines estilo AND término — both must match", () => {
    const m = manifest([
      img({ id: "a", style: "3d-abstract", alt: "chrome ribbon" }),
      img({ id: "b", style: "claymorph", alt: "chrome ribbon" }),
    ]);
    const out = searchCuratedPhotos(m, { estilo: "claymorph", busqueda: "chrome" });
    expect(out).toEqual([expect.objectContaining({ style: "claymorph" })]);
  });

  it("defaults the limit to 6", () => {
    const images = Array.from({ length: 10 }, (_, i) => img({ id: `p${i}` }));
    const out = searchCuratedPhotos(manifest(images), {});
    expect(out).toHaveLength(6);
  });

  it("respects a smaller explicit limite", () => {
    const images = Array.from({ length: 10 }, (_, i) => img({ id: `p${i}` }));
    const out = searchCuratedPhotos(manifest(images), { limite: 2 });
    expect(out).toHaveLength(2);
  });

  it("clamps a limite above 6 down to 6 (hard max)", () => {
    const images = Array.from({ length: 10 }, (_, i) => img({ id: `p${i}` }));
    const out = searchCuratedPhotos(manifest(images), { limite: 50 });
    expect(out).toHaveLength(6);
  });

  it("ignores a nonsensical limite (0, negative, NaN) and falls back to the default", () => {
    const images = Array.from({ length: 10 }, (_, i) => img({ id: `p${i}` }));
    expect(searchCuratedPhotos(manifest(images), { limite: 0 })).toHaveLength(6);
    expect(searchCuratedPhotos(manifest(images), { limite: -3 })).toHaveLength(6);
    expect(searchCuratedPhotos(manifest(images), { limite: NaN })).toHaveLength(6);
  });

  it.each([
    ["null", null],
    ["a string", "not a manifest"],
    ["a number", 42],
    ["an array", []],
    ["an object with no images key", {}],
    ["images not an array", { images: "nope" }],
  ])("malformed manifest (%s) returns []", (_label, bad) => {
    expect(searchCuratedPhotos(bad, {})).toEqual([]);
  });

  it("skips individual malformed entries but keeps the valid ones", () => {
    const m = manifest([img({ id: "good" })]);
    (m.images as unknown[]).push(null, "nope", { id: "no-style-no-src" });
    const out = searchCuratedPhotos(m, {});
    expect(out).toHaveLength(1);
  });

  it("drops entries missing a usable src.hero URL", () => {
    const broken = img({ id: "broken" });
    (broken as { src: unknown }).src = { tablet: "x", thumb: "y" };
    const out = searchCuratedPhotos(manifest([broken, img({ id: "ok" })]), {});
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain("01-warm-glassy");
  });

  it("empty query with an empty manifest returns []", () => {
    expect(searchCuratedPhotos(manifest([]), {})).toEqual([]);
  });
});
