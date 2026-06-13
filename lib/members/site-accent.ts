// Deterministic accent pick from a page's raw HTML — no render, no AI, no
// credits. Scans color tokens (hex / rgb / hsl) in the source, drops grays
// and near-white/black tints, clusters near-identical shades, and scores
// frequency × chroma so a vivid brand color used often beats both a pale
// tint used everywhere and a loud color used once. Null = no confident
// accent; callers fall back to the neutral look.

import {
  deltaE,
  isHighSaturation,
  parseColor,
  type ParsedColor,
} from "@/lib/style-match/extract/_color-utils";

const COLOR_TOKEN_RE =
  /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b|rgba?\([^)]{3,40}\)|hsla?\([^)]{3,40}\)/g;

// Generated pages repeat their palette constantly; sampling this many tokens
// is plenty and bounds the publish-time cost on pathological documents.
const MAX_TOKENS = 4000;
const CLUSTER_DELTA_E = 4;

export function detectSiteAccent(html: string): string | null {
  const clusters: Array<{ rep: ParsedColor; count: number }> = [];
  COLOR_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let scanned = 0;
  while ((match = COLOR_TOKEN_RE.exec(html)) !== null && scanned < MAX_TOKENS) {
    scanned += 1;
    const color = parseColor(match[0]);
    if (!color || color.alpha < 0.9) continue;
    if (!isHighSaturation(color)) continue; // grays and near-grays out
    // Near-black/near-white tints read as chrome, not brand.
    if (color.oklch.l < 0.25 || color.oklch.l > 0.92) continue;
    const cluster = clusters.find((c) => deltaE(c.rep, color) < CLUSTER_DELTA_E);
    if (cluster) cluster.count += 1;
    else clusters.push({ rep: color, count: 1 });
  }
  if (clusters.length === 0) return null;
  const score = (c: { rep: ParsedColor; count: number }) =>
    c.count * c.rep.oklch.c;
  clusters.sort((a, b) => score(b) - score(a));
  return clusters[0].rep.hex;
}
