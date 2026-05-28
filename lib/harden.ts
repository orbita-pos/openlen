// Quality S1 post-processor wrapper around the Rust `harden_visual_quality`
// pass exposed by `@openlen/html-engine`. The Rust impl lives at
// crates/html-engine/src/publish/harden.rs.
//
// Surface:
//   const result = hardenVisualQuality(html);
//   if (result.warnings.length > 0) console.warn(...);
//   const finalHtml = result.html;
//
// Behaviour (load-bearing for the Quality S1 pipeline):
//
// • Border alpha cap — any `border-color: rgba(255,255,255, X)` with
//   X > 0.06 gets rewritten to 0.06; same for `rgba(0,0,0, X > 0.08)` →
//   0.08. The cap also applies inside `border` / `border-top|right|
//   bottom|left` shorthand declarations. Background, shadow, and text
//   colours are left alone — only border properties.
//
// • Tailwind border class normalize — `border-white/{10,20,…,90}` and
//   `border-black/{10,20,…,90}` get rewritten to `/5`. Mirrors the
//   curated templates which only ever use `/5`-equivalent hairlines.
//
// • Banned-phrase + generic-CTA detection — surfaces warnings without
//   rewriting. Caller (currently lib/ai-stream/generate.ts) logs them.
//   Future critic loop (Quality S3) can use these to trigger regeneration.
//
// The wrapper exposes a stable shape regardless of the underlying napi
// binding version — fields use `null` for absence and `number` for counts,
// matching the rest of lib/html-engine.ts.

import { hardenVisualQuality as rustHardenVisualQuality } from "@openlen/html-engine";

export type HardenWarningKind = "banned_phrase" | "generic_cta";

export interface HardenWarning {
  kind: HardenWarningKind;
  matched: string;
}

export interface HardenCounts {
  whiteAlphaCapped: number;
  blackAlphaCapped: number;
  tailwindWhiteNormalized: number;
  tailwindBlackNormalized: number;
}

export interface HardenResult {
  html: string;
  counts: HardenCounts;
  warnings: HardenWarning[];
}

/** Apply the Quality S1 visual-quality hardening pass.
 *
 *  Idempotent: a second call on the same input returns the same html
 *  with zero counts.
 */
export function hardenVisualQuality(html: string): HardenResult {
  const r = rustHardenVisualQuality(html);
  return {
    html: r.html,
    counts: {
      whiteAlphaCapped: r.counts.whiteAlphaCapped,
      blackAlphaCapped: r.counts.blackAlphaCapped,
      tailwindWhiteNormalized: r.counts.tailwindWhiteNormalized,
      tailwindBlackNormalized: r.counts.tailwindBlackNormalized,
    },
    warnings: r.warnings.map((w) => ({
      kind: w.kind === "banned_phrase" ? "banned_phrase" : "generic_cta",
      matched: w.matched,
    })),
  };
}
