import { normalizeBornCanonical as rustNormalizeBornCanonical } from "@/lib/html-engine";

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
 * Backed by the Rust `@openlen/html-engine` normalize chain since F1 S9.
 */
export function normalizeBornCanonical(html: string): string {
  return rustNormalizeBornCanonical(html);
}
