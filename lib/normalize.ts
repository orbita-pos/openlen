import { normalizeBornCanonical as rustNormalizeBornCanonical } from "@/lib/html-engine";
import { shadowCompare } from "@/lib/shadow-soak";

import { normalizeRadius } from "./normalize-radius";
import { normalizeSpace } from "./normalize-space";
import { normalizeType } from "./normalize-type";
import { normalizeFont } from "./normalize-font";
import { normalizeAccent } from "./normalize-accent";
import { normalizeColor } from "./normalize-color";
import { normalizeColorModes } from "./normalize-modes";

/**
 * The born-canonical normalizer chain — radius, spacing, type scale, display
 * font, accent, background + text color, then the model-designed light/dark
 * palette. Each pass hoists one design axis onto a deterministic CSS-token
 * contract the inspector's Theme controls drive. Idempotent (each pass
 * no-ops once its marker is present) and structurally non-destructive (a
 * no-op where an axis doesn't apply).
 *
 * Run once, at every ingestion point (generate / from-template / from-html)
 * and on Chat output, so every project is born canonical.
 *
 * ─── Migration note (F1 S7) ────────────────────────────────────────────
 * Routed through `lib/shadow-soak` to soak the Rust normalize chain
 * (`crates/html-engine::normalize::normalize_born_canonical`) against the
 * legacy TS chain. Default mode is `shadow-prefer-ts`, so production
 * behaviour is unchanged — Rust runs in shadow and any byte-divergence
 * lands as a `[shadow-soak] divergence` warning.
 *
 * Perf note (S2 handoff): V8 irregexp wins on regex-vs-regex (TS chain
 * ~1.2 ms p95 on mirror.html, Rust ~3.4 ms). Shadow-soak `tsMillis`/
 * `rustMillis` will confirm this on real-world docs. Correctness is what
 * matters for the migration; if shadow data confirms Rust loses, this
 * site is a candidate for `OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL=ts`
 * after the broader cutover.
 */
export function normalizeBornCanonical(html: string): string {
  return shadowCompare(
    "normalize-born-canonical",
    `bytes=${html.length}`,
    () => normalizeBornCanonicalTs(html),
    () => normalizeBornCanonicalRust(html),
    { fallbackMode: "shadow-prefer-ts" },
  );
}

function normalizeBornCanonicalTs(html: string): string {
  return normalizeColorModes(
    normalizeColor(
      normalizeAccent(
        normalizeFont(normalizeType(normalizeSpace(normalizeRadius(html)))),
      ),
    ),
  );
}

function normalizeBornCanonicalRust(html: string): string {
  return rustNormalizeBornCanonical(html);
}
