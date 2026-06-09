// TypeScript shim over the Rust `@openlen/html-engine` napi-rs binding.
//
// Why this file exists: napi-rs serializes `Option<T>` as an *absent
// property* in struct returns (`undefined` in JS), and existing TS consumers
// in this repo (lib/html-ops.ts, lib/publish/optimize-html.ts, etc.) treat
// `null` as the canonical "no result" sentinel — never `undefined`. This
// wrapper normalises `undefined` → `null` at every call site that has an
// Option<T> on the Rust side, so consumers can rely on `result.html === null`
// without writing `?? null` themselves.
//
// Public surface for the Motor HTML cutover (F1 S9): every TS consumer that
// used to live behind `lib/shadow-soak.ts` now imports from here directly.
// `lib/shadow-soak.ts` is kept as reusable infrastructure for future
// TS → Rust migrations. The HtmlStream class is re-exported verbatim — its
// constructor/write/end signatures don't touch Option<T>.
//
// Build prerequisite: `cd crates/html-engine && npm run build` must have
// produced `index.js` + `index.d.ts` for this module to type-check.

import {
  applyOps as rustApplyOps,
  buildScopedView as rustBuildScopedView,
  consolidateUnsplashCredits as rustConsolidateUnsplashCredits,
  extractLogo as rustExtractLogo,
  extractTranslatables as rustExtractTranslatables,
  HtmlStream as RustHtmlStream,
  injectLogo as rustInjectLogo,
  normalizeBornCanonical as rustNormalizeBornCanonical,
  optimizeForPublish as rustOptimizeForPublish,
  parseOps as rustParseOps,
  reinjectTranslatables as rustReinjectTranslatables,
  resolveOpIdByPath as rustResolveOpIdByPath,
  rewriteResponsiveImages as rustRewriteResponsiveImages,
  roundTrip as rustRoundTrip,
  sanitizeForPublish as rustSanitizeForPublish,
  sealRelease as rustSealRelease,
  stripOpIds as rustStripOpIds,
  tagWithOpIds as rustTagWithOpIds,
  wirePublishedForms as rustWirePublishedForms,
} from "@openlen/html-engine";

import type {
  ApplyError as RustApplyError,
  ApplyResult as RustApplyResult,
  ConsolidationResult as RustConsolidationResult,
  HtmlStreamOpts,
  HtmlStreamRemovedCounts,
  HtmlStreamResult,
  Op as RustOp,
  OptimizeResult as RustOptimizeResult,
  OptimizeStats,
  ParseResult as RustParseResult,
  ResponsiveImageEntry,
  RewriteImagesResult as RustRewriteImagesResult,
  SanitizeRemovedCounts,
  SanitizeResult as RustSanitizeResult,
  SealResult,
  ScopedView,
  TaggedHtmlResult,
  UnsplashCredit as RustUnsplashCredit,
  WireFormConfig,
} from "@openlen/html-engine";

// ─── Re-exported types ──────────────────────────────────────────────────────
//
// All types are pass-through except those that contain an `Option<String>`
// field — those get a shape with `string | null` instead of `string |
// undefined` so callers can use the canonical null-sentinel pattern.

export type {
  HtmlStreamOpts,
  HtmlStreamRemovedCounts,
  HtmlStreamResult,
  OptimizeStats,
  ResponsiveImageEntry,
  SanitizeRemovedCounts,
  ScopedView,
  SealResult,
  TaggedHtmlResult,
  WireFormConfig,
};

// ─── F1.5 publish-time types ────────────────────────────────────────────────

export interface ExtractedLogo {
  href: string;
  isDataUri: boolean;
}

export interface UnsplashCredit {
  author: string;
  authorUrl: string;
}

export interface ConsolidationResult {
  html: string;
  credits: UnsplashCredit[];
  anonymousUnsplashCount: number;
}

export interface SanitizeResult {
  html: string | null;
  errors: string[];
  removed: SanitizeRemovedCounts;
}

export interface OptimizeResult {
  html: string | null;
  errors: string[];
  stats: OptimizeStats;
}

export interface Op {
  type: string;
  target: string;
  newHtml?: string;
}

export interface ApplyError {
  opIndex: number;
  op: string;
  target: string;
  reason: string;
}

export interface ApplyResult {
  html: string | null;
  errors: ApplyError[];
  appliedCount: number;
}

export interface ParseResult {
  ops: Op[];
  errors: string[];
}

// ─── Plain re-exports (no shim needed) ─────────────────────────────────────

export function roundTrip(html: string): string {
  return rustRoundTrip(html);
}

export function normalizeBornCanonical(html: string): string {
  return rustNormalizeBornCanonical(html);
}

export function stripOpIds(html: string): string {
  return rustStripOpIds(html);
}

export function tagWithOpIds(html: string): TaggedHtmlResult {
  return rustTagWithOpIds(html);
}

export function parseOps(rawHtml: string): ParseResult {
  const r = rustParseOps(rawHtml) as RustParseResult;
  return {
    ops: r.ops.map(opFromRust),
    errors: r.errors,
  };
}

// ─── Shimmed exports (Option<T> → null) ────────────────────────────────────
//
// Each function below pulls the underlying napi result and replaces any
// `undefined` Option field with `null`. The transformation is structural,
// not behavioral — values that are present pass through verbatim.

export function sanitizeForPublish(html: string): SanitizeResult {
  const r = rustSanitizeForPublish(html) as RustSanitizeResult;
  return {
    html: r.html ?? null,
    errors: r.errors,
    removed: r.removed,
  };
}

export function optimizeForPublish(html: string): OptimizeResult {
  const r = rustOptimizeForPublish(html) as RustOptimizeResult;
  return {
    html: r.html ?? null,
    errors: r.errors,
    stats: r.stats,
  };
}

export function applyOps(taggedHtml: string, ops: Op[]): ApplyResult {
  const r = rustApplyOps(taggedHtml, ops.map(opToRust)) as RustApplyResult;
  return {
    html: r.html ?? null,
    errors: r.errors.map(applyErrorFromRust),
    appliedCount: r.appliedCount,
  };
}

export function resolveOpIdByPath(
  taggedHtml: string,
  path: string,
): string | null {
  const r = rustResolveOpIdByPath(taggedHtml, path);
  return r ?? null;
}

export function buildScopedView(
  taggedHtml: string,
  pinnedOpId: string,
): ScopedView | null {
  const r = rustBuildScopedView(taggedHtml, pinnedOpId);
  return r ?? null;
}

// ─── Class re-export ───────────────────────────────────────────────────────
//
// `HtmlStream` is both a runtime constructor and a TypeScript type — re-export
// it as-is. No shim layer because the class's constructor / write / end
// signatures don't surface any `Option<T>` field on JS.

export { RustHtmlStream as HtmlStream };

// ─── Higher-level helpers ──────────────────────────────────────────────────
//
// Built on the shimmed primitives above for callers that need a single-shot
// boolean instead of the full sanitize result.

/** Detect whether `html` contains the editor-mode `data-slot-path=` marker
 *  in any of its known variants (literal, mixed-case, entity-encoded,
 *  whitespace-around-equals). Defers to Rust's `sanitize_for_publish`
 *  slot-path gate (S3 + S5 cross-chunk scanner) which catches variants the
 *  inline `html.includes("data-slot-path=")` check misses.
 *
 *  Returns true when the gate fires. Use this everywhere the publish /
 *  ingestion paths reject editor-mode HTML — consolidates the inline call
 *  sites under one Rust-backed implementation. */
export function detectSlotPath(html: string): boolean {
  const r = sanitizeForPublish(html);
  return r.html === null;
}

// ─── F1.5 publish-time helpers ──────────────────────────────────────────────
//
// Each function here corresponds to one of the four non-Motor-HTML consumers
// F1 S9 left behind on the legacy TS parser. See
// crates/html-engine/src/publish/ for the Rust implementations and the
// per-function contracts; docs/rust-f1-5-handoff.md for the migration log.

/** Extract the page's favicon / logo URL — first `<link rel>` whose rel
 *  tokens contain "icon", or fall back to `<meta property="og:image">`.
 *  Returns null when nothing matched. The caller decides what to do with a
 *  data: URI (upload to storage vs. keep inline). */
export function extractLogo(html: string): ExtractedLogo | null {
  const r = rustExtractLogo(html);
  return r ?? null;
}

/** Bake the project's resolved logo URL into `<head>` as `<link rel="icon">`
 *  + (conditionally) `<meta property="og:image">`. Removes any existing
 *  rel="icon" / rel="shortcut" links — apple-touch-icon / mask-icon are
 *  preserved (their rel tokens are multi-char strings that don't equal
 *  either of those literals). Soft-fails to the original HTML on any
 *  no-op condition. */
export function injectLogo(html: string, logoUrl: string): string {
  return rustInjectLogo(html, logoUrl);
}

/** Defense-in-depth Unsplash attribution: harvests photographers from
 *  inline credit spans, counts anonymous (paste-URL / template-baked)
 *  Unsplash images, and injects a sr-only `<aside>` + per-credit
 *  `<meta name="image-source">` tags. Idempotent — re-running on a doc
 *  with prior artifacts strips them before writing fresh ones. */
export function consolidateUnsplashCredits(html: string): ConsolidationResult {
  const r = rustConsolidateUnsplashCredits(html) as RustConsolidationResult;
  return {
    html: r.html,
    credits: r.credits.map((c: RustUnsplashCredit) => ({
      author: c.author,
      authorUrl: c.authorUrl,
    })),
    anonymousUnsplashCount: r.anonymousUnsplashCount,
  };
}

export interface RewriteImagesResult {
  html: string;
  rewritten: number;
  lazied: number;
  heroSrc: string | null;
}

/** Rewrite manifest-matched `<img>` tags to local srcset variants with
 *  sizes / intrinsic dimensions / lazy-loading, mark the LCP hero with
 *  fetchpriority=high and inject its `<link rel=preload imagesrcset>`.
 *  Author markup wins: existing srcset / <picture> / loading / dimension
 *  attributes are never overridden. See crates/html-engine/src/publish/
 *  images.rs for the full contract. */
export function rewriteResponsiveImages(
  html: string,
  images: ResponsiveImageEntry[],
): RewriteImagesResult {
  const r = rustRewriteResponsiveImages(html, images) as RustRewriteImagesResult;
  return {
    html: r.html,
    rewritten: r.rewritten,
    lazied: r.lazied,
    heroSrc: r.heroSrc ?? null,
  };
}

/** Every translatable string of the document — visible text nodes plus
 *  human-facing attributes (alt/title/placeholder/aria-label, OG metas,
 *  submit values) — in document order. Pair with reinjectTranslatables,
 *  which walks the SAME order. See crates/html-engine/src/publish/
 *  translate.rs for the slot rules. */
export function extractTranslatables(html: string): string[] {
  return rustExtractTranslatables(html);
}

/** Replace the document's translatable strings with `texts` (extracted from
 *  the SAME html) and stamp `<html lang>`. Returns null when the slot count
 *  doesn't match — the caller must skip that locale rather than ship a
 *  half-translated page. */
export function reinjectTranslatables(
  html: string,
  texts: string[],
  lang: string,
): string | null {
  return rustReinjectTranslatables(html, texts, lang) ?? null;
}

/** Terminal publish pass: hash-locked CSP meta computed from the page's
 *  closed script set (script-src 'sha256-…' / 'none', object-src 'none',
 *  base-uri 'none', form-action 'self' + the submit origin), plus <base>
 *  stripping and rel=noopener on target=_blank anchors. Self-checks the
 *  serialized output and returns the original html (sealed:false) on any
 *  hash drift — the seal can fail, the publish never does. MUST run after
 *  every script-injecting step. See crates/html-engine/src/publish/seal.rs. */
export function sealRelease(
  html: string,
  formActionExtra?: string,
): SealResult {
  return rustSealRelease(html, formActionExtra) as SealResult;
}

/** Wire every `<form>` in `html` to OpenLen's submit endpoint at `action`,
 *  baking per-form config (success message / redirect URL) keyed by
 *  document-order index, plus the inline submit-via-fetch script (once
 *  per doc). The caller pre-computes `action` from `NEXT_PUBLIC_SITE_URL +
 *  /api/f/<subdomain>` — env-var access stays TS-side. Returns the
 *  original string verbatim when the doc has no `<form>` elements. */
export function wirePublishedForms(
  html: string,
  action: string,
  configs: WireFormConfig[],
): string {
  return rustWirePublishedForms(html, action, configs);
}

// ─── Conversion helpers ────────────────────────────────────────────────────

function opFromRust(o: RustOp): Op {
  return {
    type: o.type,
    target: o.target,
    newHtml: o.newHtml ?? undefined,
  };
}

function opToRust(o: Op): RustOp {
  return {
    type: o.type,
    target: o.target,
    newHtml: o.newHtml ?? undefined,
  } as RustOp;
}

function applyErrorFromRust(e: RustApplyError): ApplyError {
  return {
    opIndex: e.opIndex,
    op: e.op,
    target: e.target,
    reason: e.reason,
  };
}
