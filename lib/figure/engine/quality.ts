// HOW MUCH FIGURE A DEVICE GETS (spec local 2026-11-10-figuras-del-asistente, §6). On a modest phone the figure
// loses fur layers and resolution before it loses smoothness; and when even the lowest tier cannot keep up, the
// engine says so and its host shows the flat figure. Pure: the engine measures, this decides.
//
// What "slow" means matters more than the thresholds. The time between two frames is the SCREEN's pace before it
// is the device's: a phone saving battery refreshes 30 times a second and draws every one of them with ease. So
// slow is judged against the fastest the screen has been seen to go — drawing at half of that is missing frames;
// drawing at the screen's own pace, whatever it is, is not. The middle value of a window is used, not its mean:
// one long hiccup is not the device. And the ladder only goes down: stepping back up is how a figure ends up
// swinging between two qualities for as long as it lives.

export type QualityTier = 0 | 1 | 2;

/** From the least to the most: fur layers of the body, and backing pixels per CSS pixel at most. */
export const TIERS: readonly { layers: number; pixelRatio: number }[] = [
  { layers: 16, pixelRatio: 1 },
  { layers: 28, pixelRatio: 1.5 },
  { layers: 40, pixelRatio: 2 },
];

/** Under twenty frames a second it is slow whatever the screen. */
const TOO_LONG_MS = 50;
/** Over this many times the screen's own pace, frames are being missed. */
const MISSING = 1.6;
/** Slow windows in a row before a step: one bad second is a page loading, two is the device. */
const IN_A_ROW = 2;

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** `medianMs`: the middle frame time of the last window. `periodMs`: the shortest frame time this screen has shown. */
export function isSlow(medianMs: number, periodMs: number): boolean {
  if (!Number.isFinite(medianMs) || medianMs <= 0 || !Number.isFinite(periodMs) || periodMs <= 0) return false;
  return medianMs > TOO_LONG_MS || medianMs > periodMs * MISSING;
}

/** The tier to use next given how many windows in a row were slow, or "flat" when it should stop being live. */
export function nextTier(tier: QualityTier, slowWindowsInARow: number): QualityTier | "flat" {
  if (slowWindowsInARow < IN_A_ROW) return tier;
  return tier === 0 ? "flat" : ((tier - 1) as QualityTier);
}
