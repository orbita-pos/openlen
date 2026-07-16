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

// El acento DECLARADO de una página born-canonical (lib/normalize escribe
// `--ol-accent:` en :root). `--ol-accent-r:` (el triplete rgb) no matchea:
// tras "accent" viene "-r", no ":".
const DECLARED_ACCENT_RE = /--ol-accent\s*:\s*([^;}]{3,40})/;

// Generated pages repeat their palette constantly; sampling this many tokens
// is plenty and bounds the publish-time cost on pathological documents.
const MAX_TOKENS = 4000;
const CLUSTER_DELTA_E = 4;

export function detectSiteAccent(html: string): string | null {
  // El token oficial MANDA (bug te2 2026-07-15: un verde regado por el HTML
  // le ganaba por frecuencia al acento declarado — el chat y el catálogo
  // salían de un color que el dueño nunca eligió). El escaneo estadístico
  // queda como fallback para HTML sin token (importado/legacy). Un token
  // ilegible o casi-blanco/negro (chrome, no marca) también cae al escaneo.
  const declared = DECLARED_ACCENT_RE.exec(html)?.[1]?.trim();
  if (declared) {
    const color = parseColor(declared);
    if (color && color.alpha >= 0.9 && color.oklch.l >= 0.25 && color.oklch.l <= 0.92) {
      return color.hex;
    }
  }

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
