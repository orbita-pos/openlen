// HOW MUCH FIGURE A DEVICE GETS (spec local 2026-11-10-figuras-del-asistente, §6). On a modest phone the figure
// loses fur layers and resolution before it loses smoothness; and when even the lowest tier cannot keep up, the
// engine says so and its host shows the flat figure. Pure: the engine measures, this decides.

export type QualityTier = 0 | 1 | 2;

/** From the least to the most: fur layers of the body, and backing pixels per CSS pixel at most. */
export const TIERS: readonly { layers: number; pixelRatio: number }[] = [
  { layers: 16, pixelRatio: 1 },
  { layers: 28, pixelRatio: 1.5 },
  { layers: 40, pixelRatio: 2 },
];

/** Slower than this (under ~42 frames a second) and a tier is too much. */
const SLOW_MS = 24;
/** Slower than this at the lowest tier and the live figure is not worth it. */
const HOPELESS_MS = 33;
/** Faster than this, for long enough, and there is room for more. Between FAST and SLOW nothing changes. */
const FAST_MS = 12;
const STEADY_WINDOWS = 5;

/**
 * With the average milliseconds per frame over the last window, and how many windows in a row the figure has spent
 * at this tier: the tier to use next, or "flat" when it should stop being live.
 */
export function nextTier(tier: QualityTier, avgFrameMs: number, windowsAtTier: number): QualityTier | "flat" {
  if (!Number.isFinite(avgFrameMs) || avgFrameMs <= 0) return tier;
  if (tier === 0) return avgFrameMs > HOPELESS_MS ? "flat" : avgFrameMs < FAST_MS && windowsAtTier >= STEADY_WINDOWS ? 1 : 0;
  if (avgFrameMs > SLOW_MS) return (tier - 1) as QualityTier;
  if (tier < 2 && avgFrameMs < FAST_MS && windowsAtTier >= STEADY_WINDOWS) return (tier + 1) as QualityTier;
  return tier;
}
