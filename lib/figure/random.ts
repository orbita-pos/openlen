// «SORPRÉNDEME» (spec local 2026-11-10-figuras-del-asistente, §5.1): from a seed, a look that goes together.
// Deterministic — the same seed is the same figure everywhere — but what gets STORED is the look, never the seed:
// the catalog may grow and the seed would then mean another figure.
import { FIGURE_COLORS, offered, type FigureLook } from "./look";

/** mulberry32: small, seeded, good enough to pick from a catalog. Never Math.random. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function curatedLook(seed: number): FigureLook {
  const next = generator(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const eyewear = pick(offered("eyewear"));
  // The one rule of "goes together": shades would hide a smile or sleepy eyes.
  const eyes = pick(eyewear === "shades" ? offered("eyes").filter((e) => e !== "smile" && e !== "sleepy") : offered("eyes"));
  return {
    v: 1,
    shape: pick(offered("shape")),
    color: pick(FIGURE_COLORS),
    eyes,
    eyewear,
    accessory: pick(offered("accessory")),
  } as FigureLook;
}
