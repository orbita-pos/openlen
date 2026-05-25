// Born-canonical accent normalization.
//
// Identifies the page's brand accent color and makes it globally controllable
// behind `--ol-accent` (+ `--ol-accent-r`, the RGB triplet that rgba() glows
// use). Token defaults = the page's own accent → zero visual change.
//
// Identification: pools color candidates from the page's `:root` custom
// properties AND its `tailwind.config` color map — heron-class templates
// declare their palette in the config, not `:root`. A candidate named
// accent/brand/primary wins; otherwise the highest accentScore (HSV
// saturation gated to a mid-lightness band, so a background never wins).
//
// Rewrite: the accent's hardcoded occurrences are routed to var(). This is
// positive-targeted — only CSS contexts where var() resolves: `<style>`
// blocks, inline `style=` attributes, Tailwind `[#hex]` arbitrary values, and
// the `tailwind.config` colors entry. SVG presentation attributes
// (fill=/stroke=/stop-color=) are deliberately left alone — `var()` is
// unreliable there and a blind rewrite would render them black.
//
// No-op when no accent color is found in either source.

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(value: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// "Accent-ness" score in 0..1 — absolute chroma (mx-mn)/255. Unlike HSV or
// HSL saturation it inflates at NEITHER extreme: a cream tint AND a muted
// dark navy both score low, so neither a light nor a dark background
// outscores a real accent. The mid-lightness band stays as a cheap backstop.
function accentScore(c: Rgb): number {
  const mx = Math.max(c.r, c.g, c.b) / 255;
  const mn = Math.min(c.r, c.g, c.b) / 255;
  const lightness = (mx + mn) / 2;
  if (lightness < 0.12 || lightness > 0.9) return 0;
  return mx - mn;
}

const ACCENT_NAMES = new Set(["accent", "brand", "primary"]);
// Below this chroma a color is a near-neutral, never the accent.
const MIN_ACCENT_CHROMA = 0.2;

interface AccentToken {
  name: string;
  hex: string; // normalized #rrggbb (lowercase)
  rgb: Rgb;
}

interface ColorCandidate {
  name: string; // lowercased token / color-key name
  value: string; // raw value — a hex literal (anything else is discarded)
}

/** Pool candidate colors from a page: `:root` custom properties + any
 *  `tailwind.config` color map (`name: "#hex"` entries). Heron-class
 *  templates declare their palette in the config rather than `:root`. */
function collectColorCandidates(html: string): ColorCandidate[] {
  const out: ColorCandidate[] = [];
  const rootMatch = /:root\s*\{([^}]*)\}/i.exec(html);
  if (rootMatch) {
    // `;?` so the last declaration in the block (no trailing `;`) counts.
    for (const d of rootMatch[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;}]+);?/gi)) {
      out.push({ name: d[1].toLowerCase(), value: d[2].trim() });
    }
  }
  // tailwind.config color entries — `name: "#hex"` inside the config <script>.
  for (const s of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (!s[1].includes("tailwind.config")) continue;
    for (const c of s[1].matchAll(
      /['"]?([\w-]+)['"]?\s*:\s*['"](#[0-9a-fA-F]{3,8})['"]/g,
    )) {
      out.push({ name: c[1].toLowerCase(), value: c[2] });
    }
  }
  return out;
}

/** Identify the accent among a page's color candidates: one named
 *  accent/brand/primary wins; otherwise the highest accentScore. */
function findAccent(candidates: ColorCandidate[]): AccentToken | null {
  let named: AccentToken | null = null;
  let best: AccentToken | null = null;
  let bestScore = MIN_ACCENT_CHROMA;
  for (const cand of candidates) {
    const rgb = parseHex(cand.value);
    if (!rgb) continue;
    const hex =
      "#" +
      [rgb.r, rgb.g, rgb.b]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
    const token: AccentToken = { name: cand.name, hex, rgb };
    if (ACCENT_NAMES.has(cand.name) && !named) named = token;
    const score = accentScore(rgb);
    if (score > bestScore) {
      bestScore = score;
      best = token;
    }
  }
  return named ?? best;
}

/** The hex spellings of the accent to match — the 6-digit form, plus the
 *  3-digit shorthand when the color collapses to it. */
function hexForms(hex: string): string[] {
  const h = hex.slice(1).toLowerCase();
  const forms = [h];
  if (h[0] === h[1] && h[2] === h[3] && h[4] === h[5]) {
    forms.push(h[0] + h[2] + h[4]);
  }
  return forms;
}

export function normalizeAccent(html: string): string {
  if (!html) return html;
  if (html.includes("data-ol-accent")) return html; // idempotent

  const accent = findAccent(collectColorCandidates(html));
  if (!accent) return html; // no identifiable accent color

  const { r, g, b } = accent.rgb;
  const forms = hexForms(accent.hex);
  // The accent as a hex literal — not followed by a further hex digit, so
  // #rrggbb doesn't match inside #rrggbbaa.
  const hexRe = new RegExp("#(?:" + forms.join("|") + ")(?![0-9a-f])", "gi");
  // The accent as an rgb()/rgba() literal, capturing any alpha.
  const rgbRe = new RegExp(
    `rgba?\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\s*(?:,\\s*([^)]+?)\\s*)?\\)`,
    "gi",
  );
  const rewrite = (css: string): string =>
    css
      .replace(hexRe, "var(--ol-accent)")
      .replace(rgbRe, (_m, alpha) =>
        alpha
          ? `rgba(var(--ol-accent-r), ${alpha})`
          : `rgb(var(--ol-accent-r))`,
      );

  let out = html;
  // <style> blocks — CSS rules + the page's :root token definitions.
  out = out.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_m, open, css, close) => open + rewrite(css) + close,
  );
  // Inline style="" / style='' attributes.
  out = out.replace(
    /(\sstyle\s*=\s*")([^"]*)(")/gi,
    (_m, open, css, close) => open + rewrite(css) + close,
  );
  out = out.replace(
    /(\sstyle\s*=\s*')([^']*)(')/gi,
    (_m, open, css, close) => open + rewrite(css) + close,
  );
  // Tailwind arbitrary values: bg-[#hex] / text-[#hex] → [color:var(--ol-accent)].
  // The `color:` type hint is required — Tailwind can't infer a type for a
  // bare var() arbitrary value, so `bg-[var(--x)]` silently emits no rule.
  out = out.replace(
    new RegExp("\\[#(?:" + forms.join("|") + ")\\]", "gi"),
    "[color:var(--ol-accent)]",
  );
  // A tailwind.config colors entry equal to the accent (quoted hex literal).
  out = out.replace(
    /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi,
    (m, open, js, close) =>
      js.includes("tailwind.config")
        ? open + js.replace(hexRe, "var(--ol-accent)") + close
        : m,
  );
  // An RGB-triplet token (the `--accent-r` pattern) → --ol-accent-r, so any
  // rgba(var(--*-r)) glows already in the page track the control too.
  out = out.replace(
    new RegExp(`(--[a-z0-9-]+\\s*:\\s*)${r}\\s*,\\s*${g}\\s*,\\s*${b}\\b`, "gi"),
    "$1var(--ol-accent-r)",
  );

  // Inject the canonical tokens AFTER all rewrites so their literal values
  // survive. --ol-accent-r feeds the rewritten rgba() glows.
  const tokenStyle =
    `<style data-ol-accent>:root{--ol-accent:${accent.hex};` +
    `--ol-accent-r:${r},${g},${b};}</style>`;
  const idx = out.search(/<\/head>/i);
  return idx === -1
    ? out + tokenStyle
    : out.slice(0, idx) + tokenStyle + out.slice(idx);
}

/** The CSS variable an accent control sets. */
export const ACCENT_VAR = "--ol-accent";
