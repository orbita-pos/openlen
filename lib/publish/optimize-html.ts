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

import { optimizeForPublish as rustOptimizeForPublish } from "@/lib/html-engine";
import { bakeTailwind, type FuenteDeClases, type OptimizeResult } from "./bake-tailwind";
export { bakeTailwind, type FuenteDeClases, type OptimizeResult } from "./bake-tailwind";

export async function optimizeHtmlForProduction(
  html: string,
  fuentes: readonly FuenteDeClases[] = [],
  stylesheets: readonly string[] = [],
): Promise<OptimizeResult> {
  if (process.env.NODE_ENV !== "production") {
    return { html, baked: false, cssBytes: 0 };
  }
  const baked = await bakeTailwind(html, fuentes, stylesheets);
  const r = rustOptimizeForPublish(baked.html);
  if (r.html === null) {
    throw new Error(
      `optimize gate fired (slot-path detected): ${r.errors.join("; ")}`,
    );
  }
  return { html: r.html, baked: baked.baked, cssBytes: baked.cssBytes };
}
