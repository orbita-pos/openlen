import postcss from "postcss";

// ─────────────────────────────────────────────────────────────────────────────
// "Match to page" — recolor an inserted library section to the host page's
// palette. Deterministic token-swapping fails (a section uses --ink as text AND
// as a dark fill — one value can't serve both roles), and the ops engine can't
// edit a <style> block (tagWithOpIds skips <style>). So Match works at the
// STYLESHEET level: feed the model the host palette + the section's own scoped
// <style>, get back the recoloured CSS, and splice it in. Markup/copy/structure
// stay byte-identical — only the section's `[data-sec="slug"]` style rules change.
//
// This module is the deterministic scaffolding (extract host palette, extract +
// splice the section's <style>, build the prompt, validate the model's CSS).
// Unit-tested in match-fragment.test.ts; the Gemini call lives in the route.
// ─────────────────────────────────────────────────────────────────────────────

export interface HostPalette {
  bg: string | null;
  fg: string | null;
  accent: string | null;
  surface: string | null;
  border: string | null;
  fgDim: string | null;
  /** Inferred from bg luminance — what the section should match. */
  mode: "dark" | "light" | "unknown";
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Collect every `--name: value` declared in the document head's :root blocks
 *  and on the <html> inline style, then resolve var() chains to literals. Host
 *  pages alias `--bg: var(--ol-bg)` with `--ol-bg:#08090a` on <html style>, so a
 *  naive `--bg` read returns `var(--ol-bg)` — we must follow the chain. */
export function extractHostPalette(html: string): HostPalette {
  const head = sliceHead(html);
  const vars: Record<string, string> = {};

  // <html style="--ol-bg:#08090a; --ol-fg:#ececee">
  const htmlStyle = /<html\b[^>]*\bstyle\s*=\s*"([^"]*)"/i.exec(html)?.[1] ?? "";
  collectDecls(htmlStyle, vars);

  // every :root { … } block (there are several — tokens, scales, accent)
  for (const block of matchAll(head, /:root[^{]*\{([^}]*)\}/gi)) {
    collectDecls(block[1], vars);
  }

  const resolve = (name: string, seen = new Set<string>()): string | null => {
    const raw = vars[name];
    if (raw == null || seen.has(name)) return null;
    seen.add(name);
    const v = raw.trim();
    const varRef = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/i.exec(v);
    if (varRef) {
      const inner = resolve(varRef[1], seen);
      if (inner) return inner;
      return varRef[2]?.trim() ?? null; // fallback literal in the var()
    }
    return v;
  };

  const bg = pickColor(resolve, ["--bg", "--ol-bg", "--background", "--paper"]);
  const fg = pickColor(resolve, ["--fg", "--ol-fg", "--ink", "--text", "--foreground"]);
  const accent = pickColor(resolve, ["--accent", "--ol-accent", "--primary"]);
  const surface = pickColor(resolve, ["--surface", "--bg-2", "--card", "--ol-surface", "--paper"]);
  const border = pickColor(resolve, ["--border", "--hair", "--line", "--rule"]);
  const fgDim = pickColor(resolve, ["--fg-dim", "--fg-muted", "--ink-2", "--muted"]);

  return { bg, fg, accent, surface, border, fgDim, mode: inferMode(bg) };
}

function pickColor(
  resolve: (n: string) => string | null,
  names: string[],
): string | null {
  for (const n of names) {
    const v = resolve(n);
    if (v) return v;
  }
  return null;
}

/** dark vs light from the background colour's perceived luminance. */
function inferMode(bg: string | null): "dark" | "light" | "unknown" {
  const rgb = parseColor(bg);
  if (!rgb) return "unknown";
  const [r, g, b] = rgb;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum < 0.5 ? "dark" : "light";
}

function parseColor(c: string | null): [number, number, number] | null {
  if (!c) return null;
  const s = c.trim().toLowerCase();
  const hex = HEX_RE.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(s);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  return null;
}

export interface SectionStyle {
  /** The full <style>…</style> tag (for splicing). */
  styleTag: string;
  /** Just the CSS inside it (what the model rewrites). */
  css: string;
  /** Index of styleTag in the source html. */
  index: number;
}

/** Find the section's scoped <style> block (the one whose CSS targets
 *  `[data-sec="slug"]`). Returns the FIRST match — inserts of the same slug
 *  share an identical, slug-scoped stylesheet, so theming one themes all. */
export function extractSectionStyle(html: string, slug: string): SectionStyle | null {
  const needle = `[data-sec="${slug}"]`;
  for (const m of matchAll(html, /<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (m[1].includes(needle)) {
      return { styleTag: m[0], css: m[1], index: m.index };
    }
  }
  return null;
}

/** Replace the section's scoped stylesheet CSS with the recoloured CSS,
 *  preserving everything else byte-for-byte. Rewrites EVERY <style> block scoped
 *  to the slug — if the section was inserted more than once there are duplicate
 *  identical stylesheets, and a later un-recoloured one would otherwise win the
 *  cascade and keep the section its old colour. */
export function spliceSectionStyle(html: string, slug: string, newCss: string): string | null {
  const needle = `[data-sec="${slug}"]`;
  let replaced = 0;
  const out = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (tag) => {
    if (!tag.includes(needle)) return tag;
    replaced++;
    const open = tag.slice(0, tag.indexOf(">") + 1);
    return `${open}\n${newCss}\n</style>`;
  });
  return replaced > 0 ? out : null;
}

/** The model output is trusted only if it's CSS that still scopes to the
 *  section (so it can't leak global rules) and parses. */
export function validateRecolouredCss(css: string, slug: string): { ok: boolean; reason?: string } {
  const trimmed = css.trim();
  if (trimmed.length < 20) return { ok: false, reason: "too short" };
  if (!trimmed.includes(`[data-sec="${slug}"]`)) return { ok: false, reason: "lost the [data-sec] scope" };
  if (/<\/?[a-z]/i.test(trimmed.replace(/content\s*:\s*["'][^"']*["']/gi, ""))) {
    return { ok: false, reason: "contains HTML tags" };
  }
  try {
    postcss.parse(trimmed);
  } catch {
    return { ok: false, reason: "unparseable CSS" };
  }
  return { ok: true };
}

export function buildMatchPrompt(palette: HostPalette, css: string, slug: string): string {
  const line = (k: string, v: string | null) => (v ? `- ${k}: ${v}` : null);
  const tokens = [
    line("page background", palette.bg),
    line("primary text", palette.fg),
    line("muted/secondary text", palette.fgDim),
    line("accent", palette.accent),
    line("elevated surface (cards/panels)", palette.surface),
    line("hairline/border", palette.border),
  ].filter(Boolean).join("\n");

  return `You are restyling ONE landing-page section to sit natively inside a host page. Rewrite ONLY the section's scoped stylesheet so its COLORS match the host. Return ONLY CSS — no markdown, no HTML, no commentary.

HOST PAGE PALETTE (the section must visually belong here; the host is a ${palette.mode} page):
${tokens}

RULES:
- Keep EVERY selector exactly as-is (they are all scoped to [data-sec="${slug}"] — do not add, remove, rename, or unscope any selector, and never emit a rule that isn't prefixed with [data-sec="${slug}"]).
- Keep all layout, spacing, sizing, font-family, border-radius, transitions, animations, and @keyframes UNCHANGED. Change colour-related values only: background, color, border-color, box-shadow tints, gradient stops, fills.
- Recolour so the section reads as part of a ${palette.mode} page: backgrounds should sit on the host background, text must be legible (light text on dark, dark text on light), surfaces/cards should use the host's elevated surface, borders the host hairline.
- Be role-aware: a token like --ink may be used BOTH as body text AND as a dark contrast fill. Don't just swap one value — adjust each RULE so it makes sense (e.g. a "dark strip" that used --ink as its background should become a host surface or accent strip with legible text, not an invisible same-on-same block).
- Adopt the host accent (${palette.accent ?? "keep the section's accent"}) for primary buttons/links/highlights; keep the section's overall structure and personality.
- Do NOT touch any data-* attributes or add data-slot-path.

SECTION STYLESHEET TO RECOLOUR (return the rewritten version of exactly this):
${css}`;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function sliceHead(html: string): string {
  const end = html.search(/<\/head>/i);
  return end >= 0 ? html.slice(0, end) : html.slice(0, 8000);
}

function collectDecls(cssText: string, into: Record<string, string>): void {
  for (const m of matchAll(cssText, /(--[\w-]+)\s*:\s*([^;]+)/g)) {
    const name = m[1].trim();
    if (!(name in into)) into[name] = m[2].trim();
  }
}

function matchAll(s: string, re: RegExp): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = r.exec(s)) !== null) {
    out.push(m);
    if (m.index === r.lastIndex) r.lastIndex++;
  }
  return out;
}
