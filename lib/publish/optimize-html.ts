// ─────────────────────────────────────────────────────────────────────────────
// Publish-time HTML optimizer.
//
// Curated + AI-generated pages ship with the Tailwind CDN runtime
// (`cdn.tailwindcss.com`) for editor-preview convenience. That CDN is the
// Tailwind v3 *Play* build — a render-blocking <script> in <head> that ships
// a full CSS JIT engine (~360 KB) and compiles utilities in the visitor's
// browser on every load (FOUC + render-block + main-thread TBT + a hard
// third-party dependency). At publish we bake it out:
//
//   1. Compile the page's used utilities with Tailwind's PostCSS plugin,
//      scanning the literal HTML as content (so arbitrary values like
//      `bg-[#0F0F0F]` are captured too) — typically <15 KB of CSS.
//   2. Replace the CDN <script> with an inline <style data-tw-baked>.
//   3. Hand off to the Rust `optimize_for_publish` pass (S4 Option C) which
//      minifies the HTML + minifies the inline CSS we just injected.
//
// Theme: `sanitizeForPublish` extrae el `tailwind.config` inline del template
// y lo re-inyecta como carrier de datos `<script data-ol-tw>` (validado, bytes
// nuestros — lib/publish/tw-config.ts). El bake LEE ese carrier y compila con
// el `theme.extend` REAL del template; sin carrier compila default-theme como
// siempre. (Antes de 2026-07-17 la config simplemente se perdía y bg-ink /
// text-lime de 53 templates compilaban a nada — el bug lume/hovers.) Plain
// `<style>` blocks (`:root` vars, keyframes, custom classes) are not Tailwind
// and pass through untouched. Templates use no `@apply`; `?plugins=` keeps
// the CDN (y su carrier, que el CDN sí lee en runtime).
//
// Safety: the bake never blocks a publish. If no plain CDN script is present
// it's a no-op (idempotent — safe on already-baked HTML); if the CDN uses the
// `?plugins=` variant (whose plugin utilities we don't have installed) the CDN
// is kept; if the Tailwind compile throws (e.g. a standalone-tracer asset miss)
// it falls back to the original HTML so the page still works via the CDN.
//
// Dev-mode skip: in non-production the function passes HTML through unchanged.
// Next.js webpack on Windows mangles tailwindcss's package-relative asset
// paths (preflight.css), so the bake only runs in standalone prod builds —
// `next.config.ts` externalises tailwindcss/postcss and copies their CSS
// assets into the standalone tree so the prod resolve works. Editor preview
// doesn't call this function anyway.
//
// Slot-path gate: the Rust `optimize_for_publish` returns `html: null` when it
// detects the editor-mode `data-slot-path=` marker. Defense-in-depth — the
// upstream `detectSlotPath` gate at `publishToDir` should have caught it first;
// throwing here keeps the marker off disk.
// ─────────────────────────────────────────────────────────────────────────────

import postcss from "postcss";
import tailwindcss from "tailwindcss";

import { optimizeForPublish as rustOptimizeForPublish } from "@/lib/html-engine";
import { readTwCarrier, stripTwCarrier } from "./tw-config";

const TAILWIND_INPUT = "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n";

// Match the Tailwind Play CDN <script> in <head>. Group 1 captures everything
// after `.com` up to the closing quote — used to detect the `?plugins=` variant.
const CDN_SCRIPT_RE =
  /<script\b[^>]*\bsrc=["']https?:\/\/(?:cdn|play)\.tailwindcss\.com([^"']*)["'][^>]*>\s*<\/script>/i;

export interface OptimizeResult {
  html: string;
  /** True when the Tailwind CDN <script> was replaced with inline baked CSS. */
  baked: boolean;
  /** Bytes of generated CSS before the Rust minify (0 when not baked). */
  cssBytes: number;
}

export async function optimizeHtmlForProduction(
  html: string,
): Promise<OptimizeResult> {
  if (process.env.NODE_ENV !== "production") {
    return { html, baked: false, cssBytes: 0 };
  }
  const baked = await bakeTailwind(html);
  const r = rustOptimizeForPublish(baked.html);
  if (r.html === null) {
    throw new Error(
      `optimize gate fired (slot-path detected): ${r.errors.join("; ")}`,
    );
  }
  return { html: r.html, baked: baked.baked, cssBytes: baked.cssBytes };
}

/**
 * Strip the Tailwind CDN runtime and inline the minimal CSS the page needs.
 * Pure (no Rust, no env) so it's unit-testable on its own. Returns the HTML
 * unchanged + `baked:false` on every safe-skip path (no CDN script, `?plugins=`
 * variant, or compile failure) so it can never break a publish.
 */
export async function bakeTailwind(html: string): Promise<OptimizeResult> {
  const m = CDN_SCRIPT_RE.exec(html);
  if (!m) return { html, baked: false, cssBytes: 0 };
  // The `?plugins=forms,typography,…` variant pulls in official plugins whose
  // utilities we don't have installed — baking would silently drop them, so
  // keep the CDN for those pages.
  if (/\bplugins=/i.test(m[1] ?? "")) {
    return { html, baked: false, cssBytes: 0 };
  }

  let css: string;
  try {
    // El carrier data-ol-tw (lib/publish/tw-config.ts) trae el theme.extend
    // validado del tailwind.config original del template — sin él, bg-ink /
    // text-lime y compañía compilan a NADA (el bug lume/hovers).
    css = await generateTailwindCss(html, readTwCarrier(html) ?? {});
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[optimize-html] Tailwind bake failed; serving CDN HTML:",
      err instanceof Error ? err.message : err,
    );
    return { html, baked: false, cssBytes: 0 };
  }

  // Strip the CDN <script>, then inject the baked <style> at the END of
  // <head> (after the page's own static <style> blocks). The Tailwind Play
  // CDN appends its generated <style> to document.head at runtime, so its
  // utilities win specificity TIES against the page's custom classes (e.g.
  // `class="display tracking-tight"` — both single-class, source order
  // decides). Injecting in-place where the script was would flip those ties
  // and diverge from what the author saw. Function-form replacements so `$`
  // sequences in the CSS aren't read as regex backreferences.
  const styleTag = `<style data-tw-baked>\n${css}\n</style>`;
  // El carrier ya cumplió (su extend está compilado en el CSS) — fuera del
  // HTML final, igual que el CDN.
  const withoutCdn = stripTwCarrier(html.replace(CDN_SCRIPT_RE, ""));
  const headClose = /<\/head\s*>/i;
  const out = headClose.test(withoutCdn)
    ? withoutCdn.replace(headClose, (close) => `${styleTag}${close}`)
    : stripTwCarrier(html).replace(CDN_SCRIPT_RE, () => styleTag); // no </head>: fall back in-place
  return { html: out, baked: true, cssBytes: css.length };
}

async function generateTailwindCss(
  html: string,
  extend: Record<string, unknown> = {},
): Promise<string> {
  const result = await postcss([
    tailwindcss({
      content: [{ raw: html, extension: "html" }],
      theme: { extend },
      plugins: [],
      corePlugins: { preflight: true },
    } as Parameters<typeof tailwindcss>[0]),
  ]).process(TAILWIND_INPUT, { from: undefined });

  return result.css;
}
