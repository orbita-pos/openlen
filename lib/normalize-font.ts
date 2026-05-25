// Born-canonical display-font normalization — Tier 3, slice 2.
//
// Fonts on a generated page live in literal `font-family:` CSS declarations
// (body{}, .display{}, headings), not Tailwind utilities — so unlike the
// radius axis there is no config override to lean on. This pass identifies
// the page's display font (the non-body, non-mono family), hoists it behind
// a `--ol-font-display` token, and rewrites its `font-family` declarations to
// `var(--ol-font-display)`. The token default equals the page's own font, so
// it is a zero-visual-change pass until a control changes the token.
//
// No-op on a one-font page (no distinct display font to control). Runs on
// `/api/generate` output; never on curated templates or pasted HTML.

// CSS generic / system keywords — never "the display font".
const GENERIC = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "cursive",
  "fantasy",
  "inherit",
  "initial",
  "unset",
]);

const MONO_RE = /\bmono(?:space)?\b/i;

/** First family in a `font-family` value — de-quoted, lowercased, for matching. */
function familyKey(value: string): string {
  const first = value.split(",")[0] ?? "";
  return first.trim().replace(/^['"]+|['"]+$/g, "").toLowerCase();
}

// The display fonts the Theme picker offers. Single source of truth — the
// FontControl reads this list and DISPLAY_FONTS_LINK preloads exactly these
// families; keep the two in sync.
export const DISPLAY_FONTS: Array<{ name: string; css: string }> = [
  { name: "Inter", css: "'Inter', sans-serif" },
  { name: "Geist", css: "'Geist', sans-serif" },
  { name: "Manrope", css: "'Manrope', sans-serif" },
  { name: "Plus Jakarta Sans", css: "'Plus Jakarta Sans', sans-serif" },
  { name: "Outfit", css: "'Outfit', sans-serif" },
  { name: "Space Grotesk", css: "'Space Grotesk', sans-serif" },
  { name: "Fraunces", css: "'Fraunces', serif" },
  { name: "Source Serif 4", css: "'Source Serif 4', serif" },
  { name: "Crimson Pro", css: "'Crimson Pro', serif" },
  { name: "Playfair Display", css: "'Playfair Display', serif" },
  { name: "DM Serif Display", css: "'DM Serif Display', serif" },
  { name: "Instrument Serif", css: "'Instrument Serif', serif" },
];

// One Google Fonts request covering every DISPLAY_FONTS family. A generated
// page <link>s only the 1-2 families it uses — injecting this lets the Theme
// font picker switch to any of the listed families and have it actually
// render, on the editor preview and the published page alike (the link
// persists on save).
const DISPLAY_FONTS_LINK =
  '<link data-ol-font rel="stylesheet" href="https://fonts.googleapis.com/css2?' +
  "family=Inter:wght@400;500;600;700&amp;" +
  "family=Geist:wght@400;500;600;700&amp;" +
  "family=Manrope:wght@400;500;600;700&amp;" +
  "family=Plus+Jakarta+Sans:wght@400;500;600;700&amp;" +
  "family=Outfit:wght@400;500;600;700&amp;" +
  "family=Space+Grotesk:wght@400;500;600;700&amp;" +
  "family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&amp;" +
  "family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&amp;" +
  "family=Crimson+Pro:wght@400;500;600;700&amp;" +
  "family=Playfair+Display:wght@400;500;600;700&amp;" +
  "family=DM+Serif+Display&amp;" +
  'family=Instrument+Serif&amp;display=swap">';

export function normalizeFont(html: string): string {
  if (!html) return html;
  if (html.includes("data-ol-font")) return html; // idempotent

  // Body font — anchored on the `body { … }` rule, so it is never mistaken
  // for the display font. The char class before `body` rules out `.body-x`.
  let bodyKey = "";
  const bodyRule =
    /(?:^|[\s,{}>])body\s*\{[^}]*font-family\s*:\s*([^;}]+)/i.exec(html);
  if (bodyRule) bodyKey = familyKey(bodyRule[1]);

  // Every font-family value, in document order.
  const values = [...html.matchAll(/font-family\s*:\s*([^;}]+)/gi)].map((m) =>
    m[1].trim(),
  );

  // Display font = the first family that is not the body font, not mono,
  // and not a generic keyword.
  let displayName = "";
  for (const value of values) {
    if (MONO_RE.test(value)) continue;
    const key = familyKey(value);
    if (!key || key === bodyKey || GENERIC.has(key)) continue;
    displayName = (value.split(",")[0] ?? "")
      .trim()
      .replace(/^['"]+|['"]+$/g, "");
    break;
  }
  if (!displayName) return html; // one-font page — nothing to make controllable

  const displayKey = displayName.toLowerCase();
  const isSerif = values.some(
    (v) =>
      familyKey(v) === displayKey &&
      /\bserif\b/i.test(v) &&
      !/sans-serif/i.test(v),
  );
  const fallback = isSerif ? "serif" : "sans-serif";

  // Rewrite only `font-family` declarations whose first family is the display
  // font — never page text, never the Google Fonts <link> (it uses the
  // `+`-encoded `family=` form, not `font-family:`).
  const out = html.replace(
    /font-family\s*:\s*([^;}]+)/gi,
    (match: string, value: string) => {
      if (familyKey(value) !== displayKey) return match;
      const parts = value.split(",");
      parts[0] = " var(--ol-font-display)";
      return "font-family:" + parts.join(",");
    },
  );

  // Inject the token AFTER the rewrite so its own literal value survives, and
  // pair it with the font preload so every picker option renders truthfully.
  const tokenStyle =
    `<style data-ol-font>:root{--ol-font-display:'${displayName}',${fallback};}</style>`;
  const injection = DISPLAY_FONTS_LINK + tokenStyle;
  const idx = out.search(/<\/head>/i);
  return idx === -1
    ? out + injection
    : out.slice(0, idx) + injection + out.slice(idx);
}

/** The CSS variable a display-font control sets. Exported so the control and
 *  the normalizer can't drift. */
export const FONT_DISPLAY_VAR = "--ol-font-display";
