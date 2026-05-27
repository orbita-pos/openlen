// ─────────────────────────────────────────────────────────────────────────────
// Publish-time HTML optimizer.
//
// Curated templates ship with the Tailwind CDN runtime (`cdn.tailwindcss.com`)
// for editor preview convenience. At publish, the Rust `optimize_for_publish`
// pass (S4 Option C) minifies the HTML + inlines-CSS — no Tailwind bake.
// Published pages depend on the Tailwind CDN at render time; the bandwidth /
// TTFB win is the disk size shrinking by ~94 KB per publish (soak p50). The
// FCP impact of the CDN dependency is unmeasured and is the operator's
// post-deploy verification.
//
// Idempotent: minify on already-minified HTML is a near no-op (a few bytes of
// jitter at most).
//
// Dev-mode skip: in non-production environments the function passes the HTML
// through unchanged. Next.js webpack on Windows mangled tailwindcss's asset
// paths in the legacy bake path, so dev publishes never invoked the
// optimizer — editor preview uses the CDN <script> directly. The Rust minify
// could in principle run in dev (no webpack involvement), but editor preview
// doesn't call this function anyway, so the gate stays for parity.
//
// Slot-path gate: the Rust `optimize_for_publish` returns `html: null` when
// it detects the editor-mode `data-slot-path=` marker. Defense-in-depth —
// the upstream `detectSlotPath` gate at `publishToDir` should have caught it
// first; if it didn't, throwing here keeps the marker off disk.
// ─────────────────────────────────────────────────────────────────────────────

import { optimizeForPublish as rustOptimizeForPublish } from "@/lib/html-engine";

export interface OptimizeResult {
  html: string;
  /** Always false — the Tailwind bake step was removed in F1 S9. Kept on
   *  the contract because callers (filesystem.ts) only read `.html`, so the
   *  documentary field is harmless and removing it would churn the type. */
  baked: boolean;
  /** Always 0 — bake-byte counter is no longer meaningful. */
  cssBytes: number;
}

export async function optimizeHtmlForProduction(
  html: string,
): Promise<OptimizeResult> {
  if (process.env.NODE_ENV !== "production") {
    return { html, baked: false, cssBytes: 0 };
  }
  const r = rustOptimizeForPublish(html);
  if (r.html === null) {
    throw new Error(
      `optimize gate fired (slot-path detected): ${r.errors.join("; ")}`,
    );
  }
  return { html: r.html, baked: false, cssBytes: 0 };
}
