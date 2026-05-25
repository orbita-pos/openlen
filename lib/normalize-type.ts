// Born-canonical type-scale normalization.
//
// Makes the page's type size globally controllable, the same way the radius
// axis works: a Tailwind `fontSize` config override wired to var() tokens
// scaled by `--ol-text-scale`, plus a :root token block whose defaults equal
// Tailwind's own sizes — so injecting it changes nothing until a control
// moves the scale. Literal `font-size:` declarations in <style> are scaled
// too. Idempotent.

// Tailwind's default fontSize scale — [key, size, line-height].
const SIZES: Array<[string, string, string]> = [
  ["xs", "0.75rem", "1rem"],
  ["sm", "0.875rem", "1.25rem"],
  ["base", "1rem", "1.5rem"],
  ["lg", "1.125rem", "1.75rem"],
  ["xl", "1.25rem", "1.75rem"],
  ["2xl", "1.5rem", "2rem"],
  ["3xl", "1.875rem", "2.25rem"],
  ["4xl", "2.25rem", "2.5rem"],
  ["5xl", "3rem", "1"],
  ["6xl", "3.75rem", "1"],
  ["7xl", "4.5rem", "1"],
  ["8xl", "6rem", "1"],
  ["9xl", "8rem", "1"],
];

// Defensively merges into tailwind.config — composes with the radius axis's
// own config script; the fontSize mapping always wins so theming is sure.
const CONFIG_SCRIPT =
  `<script data-ol-type>(function(){` +
  `var w=window;w.tailwind=w.tailwind||{};` +
  `var c=w.tailwind.config||{};var t=c.theme||{};var e=t.extend||{};` +
  `e.fontSize=Object.assign({},e.fontSize,{` +
  SIZES.map((s) => `'${s[0]}':['var(--ol-text-${s[0]})','var(--ol-lh-${s[0]})']`).join(
    ",",
  ) +
  `});` +
  `w.tailwind.config=Object.assign({},c,{theme:Object.assign({},t,` +
  `{extend:Object.assign({},e)})});` +
  `})();</script>`;

// The scale token + per-step sizes derived from it. Defaults equal Tailwind's
// own values, so injecting this changes nothing visually.
const TOKENS_STYLE =
  `<style data-ol-type>:root{--ol-text-scale:1;` +
  SIZES.map(
    (s) =>
      `--ol-text-${s[0]}:calc(${s[1]}*var(--ol-text-scale));` +
      `--ol-lh-${s[0]}:calc(${s[2]}*var(--ol-text-scale));`,
  ).join("") +
  `}</style>`;

const INJECTION = CONFIG_SCRIPT + TOKENS_STYLE;

/** Scale one font-size length token by `--ol-text-scale`. Non-length values
 *  (keywords, %) are left as-is. */
function scaleFontToken(tok: string): string {
  const m = /^(\d*\.?\d+)(px|rem|em)$/i.exec(tok);
  if (!m || parseFloat(m[1]) === 0) return tok;
  return `calc(${tok} * var(--ol-text-scale))`;
}

/** Make literal `font-size:` declarations in <style> blocks track the scale,
 *  the way Tailwind `text-*` utilities do via the config override. A
 *  declaration with no scalable length (keyword, %, var/calc/clamp) is left
 *  byte-identical. */
function scaleLiteralFontSizes(html: string): string {
  return html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_m, open: string, css: string, close: string) =>
      open +
      css.replace(
        /font-size\s*:\s*([^;}]+)/gi,
        (decl: string, value: string) => {
          const v = value.trim();
          if (/var\(|calc\(|clamp\(/i.test(v)) return decl;
          const scaled = scaleFontToken(v);
          return scaled === v ? decl : "font-size: " + scaled;
        },
      ) +
      close,
  );
}

/** Make a page's type size globally themeable — Tailwind `text-*` utilities
 *  (via the config override) and literal `font-size:` CSS alike. Idempotent. */
export function normalizeType(html: string): string {
  if (!html) return html;
  if (html.includes("data-ol-type")) return html;
  const scaled = scaleLiteralFontSizes(html);
  const idx = scaled.search(/<\/head>/i);
  return idx === -1
    ? scaled + INJECTION
    : scaled.slice(0, idx) + INJECTION + scaled.slice(idx);
}

/** The CSS variable a type-scale control sets (1 = Tailwind default). */
export const TYPE_SCALE_VAR = "--ol-text-scale";
