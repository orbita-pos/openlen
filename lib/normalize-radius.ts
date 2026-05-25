// Born-canonical radius normalization — Tier 3, slice 1.
//
// A generated page's corner radius is 100% Tailwind `rounded-*` utilities.
// This pass makes that radius globally themeable, deterministically, without
// touching the page's markup: it injects a Tailwind `borderRadius` scale that
// resolves through CSS variables, plus a `:root` scale token. The token
// defaults equal Tailwind's own radius values, so the page renders
// identically until a radius control changes `--ol-r-scale`.
//
// Determinism lives HERE, not in the model — the generation prompt is not
// trusted to emit the token contract (the corpus showed it ignores such
// instructions: 0/23 templates honored the prompt's `--radius`). Runs on
// `/api/generate` output; never on curated templates or pasted HTML.

// Placed at the end of <head> (after the Tailwind CDN script) and defensively
// merges, so a page that already set tailwind.config keeps its other theme
// extensions; the radius mapping always wins so theming is guaranteed.
const CONFIG_SCRIPT =
  `<script data-ol-radius>(function(){` +
  `var w=window;w.tailwind=w.tailwind||{};` +
  `var c=w.tailwind.config||{};var t=c.theme||{};var e=t.extend||{};` +
  `e.borderRadius=Object.assign({},e.borderRadius,{` +
  `sm:'var(--ol-r-sm)',DEFAULT:'var(--ol-r)',md:'var(--ol-r-md)',` +
  `lg:'var(--ol-r-lg)',xl:'var(--ol-r-xl)',` +
  `'2xl':'var(--ol-r-2xl)','3xl':'var(--ol-r-3xl)'});` +
  `w.tailwind.config=Object.assign({},c,{theme:Object.assign({},t,` +
  `{extend:Object.assign({},e)})});` +
  `})();</script>`;

// The scale token + per-step radii derived from it. Defaults equal Tailwind's
// own borderRadius values, so injecting this changes nothing visually.
// `rounded-none` (0) and `rounded-full` (pill) are intentionally NOT themed.
const TOKENS_STYLE =
  `<style data-ol-radius>:root{` +
  `--ol-r-scale:1;` +
  `--ol-r-sm:calc(0.125rem*var(--ol-r-scale));` +
  `--ol-r:calc(0.25rem*var(--ol-r-scale));` +
  `--ol-r-md:calc(0.375rem*var(--ol-r-scale));` +
  `--ol-r-lg:calc(0.5rem*var(--ol-r-scale));` +
  `--ol-r-xl:calc(0.75rem*var(--ol-r-scale));` +
  `--ol-r-2xl:calc(1rem*var(--ol-r-scale));` +
  `--ol-r-3xl:calc(1.5rem*var(--ol-r-scale));` +
  `}</style>`;

const INJECTION = CONFIG_SCRIPT + TOKENS_STYLE;

/** Scale one border-radius length token so it tracks `--ol-r-scale`. Pills
 *  (≥100px), 0, %, and non-length keywords are left as-is. */
function scaleRadiusToken(tok: string): string {
  const m = /^(\d*\.?\d+)(px|rem|em)$/i.exec(tok);
  if (!m) return tok;
  const n = parseFloat(m[1]);
  if (n === 0) return tok;
  if (m[2].toLowerCase() === "px" && n >= 100) return tok;
  return `calc(${tok} * var(--ol-r-scale))`;
}

/** Make literal `border-radius:` declarations in <style> blocks track the
 *  global scale, the way Tailwind `rounded-*` utilities do via the config
 *  override. A declaration with no scalable length (pills, 0, %, var/calc)
 *  is left byte-identical. */
function scaleLiteralRadii(html: string): string {
  return html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_m, open: string, css: string, close: string) =>
      open +
      css.replace(
        /border-radius\s*:\s*([^;}]+)/gi,
        (decl: string, value: string) => {
          if (/var\(|calc\(/i.test(value)) return decl;
          const toks = value.trim().split(/\s+/);
          const scaled = toks.map(scaleRadiusToken);
          if (scaled.every((s, i) => s === toks[i])) return decl;
          return "border-radius: " + scaled.join(" ");
        },
      ) +
      close,
  );
}

/** Make a page's corner radius globally themeable — Tailwind `rounded-*`
 *  utilities (via the config override) and literal `border-radius:` CSS
 *  alike. Idempotent — a no-op on HTML that already carries the tokens. */
export function normalizeRadius(html: string): string {
  if (!html) return html;
  if (html.includes("data-ol-radius")) return html;
  const scaled = scaleLiteralRadii(html);
  const idx = scaled.search(/<\/head>/i);
  if (idx === -1) return scaled + INJECTION;
  return scaled.slice(0, idx) + INJECTION + scaled.slice(idx);
}

/** The CSS variable a radius control sets: 1 = Tailwind default, 0 = sharp,
 *  >1 = rounder. Exported so the control and the normalizer can't drift. */
export const RADIUS_SCALE_VAR = "--ol-r-scale";
