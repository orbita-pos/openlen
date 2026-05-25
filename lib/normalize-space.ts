// Born-canonical spacing (density) normalization.
//
// Makes the page's whitespace globally controllable, like the radius / type
// axes: Tailwind `padding` / `margin` / `gap` config overrides wired to var()
// tokens scaled by `--ol-space-scale`, plus a :root token block whose
// defaults equal Tailwind's own spacing — zero visual change until a control
// moves the scale. Deliberately does NOT touch `spacing` globally — that
// would also scale widths / heights / insets and break layout; only the
// whitespace properties are themed. Idempotent.

// Tailwind's default spacing scale — [key, value].
const SCALE: Array<[string, string]> = [
  ["0", "0px"],
  ["px", "1px"],
  ["0.5", "0.125rem"],
  ["1", "0.25rem"],
  ["1.5", "0.375rem"],
  ["2", "0.5rem"],
  ["2.5", "0.625rem"],
  ["3", "0.75rem"],
  ["3.5", "0.875rem"],
  ["4", "1rem"],
  ["5", "1.25rem"],
  ["6", "1.5rem"],
  ["7", "1.75rem"],
  ["8", "2rem"],
  ["9", "2.25rem"],
  ["10", "2.5rem"],
  ["11", "2.75rem"],
  ["12", "3rem"],
  ["14", "3.5rem"],
  ["16", "4rem"],
  ["20", "5rem"],
  ["24", "6rem"],
  ["28", "7rem"],
  ["32", "8rem"],
  ["36", "9rem"],
  ["40", "10rem"],
  ["44", "11rem"],
  ["48", "12rem"],
  ["52", "13rem"],
  ["56", "14rem"],
  ["60", "15rem"],
  ["64", "16rem"],
  ["72", "18rem"],
  ["80", "20rem"],
  ["96", "24rem"],
];

// `0.5` → `--ol-space-0_5` (a CSS custom-property name can't contain a dot).
const varName = (key: string): string => "--ol-space-" + key.replace(".", "_");

// One Tailwind theme map, e.g. {'4':'var(--ol-space-4)',…} — shared by the
// padding / margin / gap overrides.
const MAP =
  "{" + SCALE.map(([k]) => `'${k}':'var(${varName(k)})'`).join(",") + "}";

// Defensively merges into tailwind.config — composes with the radius + type
// config scripts; the whitespace mappings always win so theming is sure.
const CONFIG_SCRIPT =
  `<script data-ol-space>(function(){` +
  `var w=window;w.tailwind=w.tailwind||{};` +
  `var c=w.tailwind.config||{};var t=c.theme||{};var e=t.extend||{};` +
  `var m=${MAP};` +
  `e.padding=Object.assign({},e.padding,m);` +
  `e.margin=Object.assign({},e.margin,m);` +
  `e.gap=Object.assign({},e.gap,m);` +
  `w.tailwind.config=Object.assign({},c,{theme:Object.assign({},t,` +
  `{extend:Object.assign({},e)})});` +
  `})();</script>`;

// The scale token + per-step values derived from it. Defaults equal
// Tailwind's own spacing, so injecting this changes nothing visually.
const TOKENS_STYLE =
  `<style data-ol-space>:root{--ol-space-scale:1;` +
  SCALE.map((s) => `${varName(s[0])}:calc(${s[1]}*var(--ol-space-scale));`).join(
    "",
  ) +
  `}</style>`;

const INJECTION = CONFIG_SCRIPT + TOKENS_STYLE;

/** Make a page's whitespace (padding / margin / gap) globally themeable.
 *  Idempotent — a no-op on HTML that already carries the spacing tokens. */
export function normalizeSpace(html: string): string {
  if (!html) return html;
  if (html.includes("data-ol-space")) return html;
  const idx = html.search(/<\/head>/i);
  return idx === -1
    ? html + INJECTION
    : html.slice(0, idx) + INJECTION + html.slice(idx);
}

/** The CSS variable a density control sets (1 = Tailwind default). */
export const SPACE_SCALE_VAR = "--ol-space-scale";
