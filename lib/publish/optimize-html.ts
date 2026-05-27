// ─────────────────────────────────────────────────────────────────────────────
// Publish-time HTML optimizer.
//
// Curated templates ship with the Tailwind CDN runtime (`cdn.tailwindcss.com`)
// for editor preview convenience. In production that script blocks initial
// paint (~200ms script eval + CSS computation) and torpedoes Lighthouse
// performance. The TS arm of this module:
//
//   1. Walks the HTML for every used utility class.
//   2. Runs Tailwind's PostCSS plugin against that content set to generate
//      the minimal CSS the page actually needs (preflight + utilities).
//   3. Strips the CDN <script> and inlines the generated CSS in <head>.
//
// Idempotent: if no CDN script is found, the HTML passes through unchanged
// — safe to run on already-baked HTML.
//
// ─── F1 S8 migration note ────────────────────────────────────────────────────
// As of session 8 (Sem 10 Phase 3) this call site routes through
// `asyncShadowCompare`. The TS arm above is preserved as `*Ts`; a new Rust
// arm (`*Rust`) wraps `optimizeForPublish` from `@openlen/html-engine` (S4
// minify-html + lightningcss inline-CSS minify, no Tailwind bake — see
// docs/rust-f1-session4-handoff.md §"Option C trade-off"). The two arms do
// *orthogonal* work — TS strips the CDN and bakes; Rust minifies — so
// every prod call logs a divergence under default deep-equal. That is
// expected and intentional: each record carries `tsBytes`/`rustBytes`,
// quantifying the data Sem 8.5 (Rust Tailwind bake) will need. Records
// with `errorShapeMismatch: true` (one arm throws, e.g. slot-path gate
// fires in Rust but TS missed it) are the actionable signal — filter
// the log on that flag.
//
// Default `fallbackMode: "shadow-prefer-ts"` means production behaviour
// is unchanged (TS bake still happens, CDN still gets stripped). After
// Sem 8.5 ships Tailwind bake in Rust, the cutover is a one-line flip
// of the default to `"rust"` (plus delete the TS arm + cheerio import).
// ─────────────────────────────────────────────────────────────────────────────

import * as cheerio from "cheerio";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

import { optimizeForPublish as rustOptimizeForPublish } from "@/lib/html-engine";
import { asyncShadowCompare } from "@/lib/shadow-soak";

const TAILWIND_INPUT = "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n";

export interface OptimizeResult {
  html: string;
  /** True when CDN replacement happened (i.e. CSS was inlined). The Rust
   *  arm always reports `false` here — its S4 build doesn't do the bake;
   *  Sem 8.5 will fill this in once the Rust Tailwind matcher lands. */
  baked: boolean;
  /** Bytes of generated CSS (0 when unchanged or when the Rust arm runs). */
  cssBytes: number;
}

export async function optimizeHtmlForProduction(
  html: string,
): Promise<OptimizeResult> {
  // Dev-mode skip: Next.js webpack on Windows mangles tailwindcss's
  // internal asset paths (preflight.css resolves to a phantom `C:\ROOT\…`
  // prefix), so the publish flow crashes. The Tailwind bake matters only
  // for prod Lighthouse — leave the CDN <script> intact when developing
  // locally; standalone prod builds (next start / systemd unit) resolve
  // the package correctly and the bake still happens there. The shadow
  // wrapper also lives behind this gate so dev never runs Rust in shadow
  // (avoids `.node` load surprises in editor preview contexts).
  if (process.env.NODE_ENV !== "production") {
    return { html, baked: false, cssBytes: 0 };
  }

  return asyncShadowCompare(
    "optimize-html-for-production",
    `bytes=${html.length}`,
    () => optimizeHtmlForProductionTs(html),
    () => optimizeHtmlForProductionRust(html),
    { fallbackMode: "shadow-prefer-ts" },
  );
}

// ─── TS arm — the original cheerio + postcss + tailwindcss bake ──────────────

export async function optimizeHtmlForProductionTs(
  html: string,
): Promise<OptimizeResult> {
  const $ = cheerio.load(html);

  // Match any tailwind CDN URL (cdn.tailwindcss.com, with or without
  // version/path suffix, and the play.tailwindcss.com staging variant).
  const cdnScript = $("script").filter((_, el) => {
    const src = $(el).attr("src") || "";
    return /(?:cdn|play)\.tailwindcss\.com/i.test(src);
  });

  if (cdnScript.length === 0) {
    return { html, baked: false, cssBytes: 0 };
  }

  // The Tailwind bake is a Lighthouse-score optimization — not load-
  // bearing for functionality. Next.js's standalone tracer sometimes
  // misses tailwindcss's bundled assets (preflight.css under
  // `node_modules/tailwindcss/lib/css/`), which throws ENOENT inside
  // the PostCSS pipeline at publish time. When that happens, fall back
  // to the unoptimized HTML: the page still works via the CDN <script>;
  // it just doesn't get the inline-CSS perf win. Better that than a
  // broken publish.
  let css: string;
  try {
    css = await generateTailwindCss(html);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[optimize-html] Tailwind bake failed; serving unoptimized HTML:",
      err instanceof Error ? err.message : err,
    );
    return { html, baked: false, cssBytes: 0 };
  }
  cdnScript.replaceWith(
    `<style data-tw-baked>\n${css}\n</style>`,
  );

  return { html: $.html(), baked: true, cssBytes: css.length };
}

// ─── Rust arm — adapter over @openlen/html-engine.optimizeForPublish ────────
//
// The Rust engine ships HTML+inline-CSS minify only (S4 Option C). Tailwind
// CDN strip + bake stays in TS until Sem 8.5. The adapter:
//   - throws on slot-path gate detection (`html: null`) so the shadow
//     harness surfaces it as `errorShapeMismatch: true` — same pattern as
//     the sanitize POC (S6 §"Engine choices #3").
//   - emits `baked: false` + `cssBytes: 0` to honour the TS contract;
//     these fields are never load-bearing for callers (filesystem.ts only
//     reads `.html`), so the shape mismatch is documentary-only.

export function optimizeHtmlForProductionRust(html: string): OptimizeResult {
  const r = rustOptimizeForPublish(html);
  if (r.html === null) {
    throw new Error(
      `optimize gate fired (slot-path detected): ${r.errors.join("; ")}`,
    );
  }
  return { html: r.html, baked: false, cssBytes: 0 };
}

async function generateTailwindCss(html: string): Promise<string> {
  const result = await postcss([
    tailwindcss({
      content: [{ raw: html, extension: "html" }],
      theme: { extend: {} },
      plugins: [],
      corePlugins: { preflight: true },
    }),
  ]).process(TAILWIND_INPUT, { from: undefined });

  return result.css;
}
