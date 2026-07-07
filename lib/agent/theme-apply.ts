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

/** Read one token's current value off the root <html> inline style, or null
 *  when the tag/attribute/token is absent. */
export function readThemeTokenFromHtml(html: string, token: string): string | null {
  const tagMatch = HTML_TAG_RE.exec(html);
  if (!tagMatch) return null;
  const styleMatch = STYLE_ATTR_RE.exec(tagMatch[0]);
  if (!styleMatch) return null;
  return parseStyleDecls(styleMatch[1]).get(token) ?? null;
}

const MODE_ATTR_RE = /\sdata-ol-mode="[^"]*"/i;

/** Read the document's current mode off the root <html> tag's data-ol-mode
 *  attribute — "dark" when set, "light" otherwise (absent = light default,
 *  same convention as the iframe/modeRef). */
export function readThemeModeFromHtml(html: string): "light" | "dark" {
  const tagMatch = HTML_TAG_RE.exec(html);
  if (!tagMatch) return "light";
  return /\sdata-ol-mode="dark"/i.test(tagMatch[0]) ? "dark" : "light";
}

/** Merge `tokens` as inline-style custom properties onto the document's root
 *  <html> tag: creates the style attribute if missing, replaces prior values
 *  of the same token, keeps the rest of the style untouched. A null/empty
 *  value REMOVES that token (parity with root.style.removeProperty in the
 *  iframe). Deriving --ol-accent-r (RGB triplet) when --ol-accent is set,
 *  same as applyThemeBundle. The special "data-ol-mode" key is written as an
 *  ATTRIBUTE on <html> (empty string = remove it), never as inline style —
 *  ported from the iframe's applyThemeBundle special-case
 *  (use-element-inspect.ts:738-740). */
export function applyThemeTokensToHtml(html: string, tokens: Record<string, string>): string {
  const tagMatch = HTML_TAG_RE.exec(html);
  if (!tagMatch) return html;
  const openTag = tagMatch[0];
  const tagStart = tagMatch.index;
  const tagEnd = tagStart + openTag.length;

  const styleMatch = STYLE_ATTR_RE.exec(openTag);
  const decls = parseStyleDecls(styleMatch?.[1] ?? "");

  let modeAttr: string | null | undefined;
  for (const [key, value] of Object.entries(tokens)) {
    if (key === "data-ol-mode") {
      modeAttr = value || null;
      continue;
    }
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
  let newTag = styleMatch
    ? openTag.slice(0, styleMatch.index) +
      ` style="${newStyleValue}"` +
      openTag.slice(styleMatch.index + styleMatch[0].length)
    : openTag.replace(/^<html\b/i, (m) => `${m} style="${newStyleValue}"`);

  if (modeAttr !== undefined) {
    newTag = newTag.replace(MODE_ATTR_RE, "");
    if (modeAttr) {
      newTag = newTag.replace(/^<html\b/i, (m) => `${m} data-ol-mode="${modeAttr}"`);
    }
  }

  return html.slice(0, tagStart) + newTag + html.slice(tagEnd);
}
