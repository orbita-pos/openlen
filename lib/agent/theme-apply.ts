// Server-side counterpart of the iframe inspect-script's applyThemeBundle
// (components/workspace-v2/use-element-inspect.ts:733) — the same write
// (merge a {token: value} bundle into <html>'s inline style, deriving
// --ol-accent-r from --ol-accent) as a pure string→string transform, so an
// agent tool can stamp a theme onto project.data.html without a browser.
//
// Only the FIRST <html …> tag is touched (regex-located, never the rest of
// the document) — mirrors the iframe writing to document.documentElement,
// never a descendant.

const HTML_TAG_RE = /<html\b[^>]*>/i;
const STYLE_ATTR_RE = /\sstyle="([^"]*)"/i;

function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

function parseStyleDecls(styleValue: string): Map<string, string> {
  const decls = new Map<string, string>();
  for (const part of styleValue.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    decls.set(key, value);
  }
  return decls;
}

function serializeStyleDecls(decls: Map<string, string>): string {
  return Array.from(decls.entries())
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

/** Merge `tokens` as inline-style custom properties onto the document's root
 *  <html> tag: creates the style attribute if missing, replaces prior values
 *  of the same token, keeps the rest of the style untouched. A null/empty
 *  value REMOVES that token (parity with root.style.removeProperty in the
 *  iframe). Deriving --ol-accent-r (RGB triplet) when --ol-accent is set,
 *  same as applyThemeBundle. */
export function applyThemeTokensToHtml(html: string, tokens: Record<string, string>): string {
  const tagMatch = HTML_TAG_RE.exec(html);
  if (!tagMatch) return html;
  const openTag = tagMatch[0];
  const tagStart = tagMatch.index;
  const tagEnd = tagStart + openTag.length;

  const styleMatch = STYLE_ATTR_RE.exec(openTag);
  const decls = parseStyleDecls(styleMatch?.[1] ?? "");

  for (const [key, value] of Object.entries(tokens)) {
    if (value === null || value === undefined || value === "") {
      decls.delete(key);
      continue;
    }
    decls.set(key, value);
    if (key === "--ol-accent") {
      const triplet = hexToRgbTriplet(value);
      if (triplet) decls.set("--ol-accent-r", triplet);
    }
  }

  const newStyleValue = serializeStyleDecls(decls);
  const newTag = styleMatch
    ? openTag.slice(0, styleMatch.index) +
      ` style="${newStyleValue}"` +
      openTag.slice(styleMatch.index + styleMatch[0].length)
    : openTag.replace(/^<html\b/i, (m) => `${m} style="${newStyleValue}"`);

  return html.slice(0, tagStart) + newTag + html.slice(tagEnd);
}
