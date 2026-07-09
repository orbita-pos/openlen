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
// Matches BOTH quote styles a style attr can be serialized with (double is
// this module's own output; single can arrive from hand-authored HTML or a
// prior editor write) — group 1 is the double-quoted body, group 2 the
// single-quoted one. Whichever matched, the full match (styleMatch[0]) is
// always replaced wholesale with a freshly double-quoted attr, so a
// single-quoted original never survives alongside a second, newly-created
// one (which would silently duplicate the style attribute).
const STYLE_ATTR_RE = /\sstyle=(?:"([^"]*)"|'([^']*)')/i;

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

/** Split a style value on `;` — but only OUTSIDE parentheses, so a value like
 *  `url(data:image/png;base64,x)` doesn't get sliced apart at the `;` inside
 *  its data URI (a plain .split(";") would mangle it into two bogus decls). */
function splitStyleDecls(styleValue: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < styleValue.length; i++) {
    const ch = styleValue[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) {
      parts.push(styleValue.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(styleValue.slice(start));
  return parts;
}

function parseStyleDecls(styleValue: string): Map<string, string> {
  const decls = new Map<string, string>();
  for (const part of splitStyleDecls(styleValue)) {
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

/** CSS treats `'` and `"` as interchangeable quote delimiters (url(...),
 *  font-family lists, etc.), but the HTML attribute this value is about to be
 *  written into is ALWAYS double-quoted (see applyThemeTokensToHtml below) —
 *  so any inner `"` surviving from a single-quoted original (or any token
 *  value) would break the attribute into junk. Convert wholesale to `'`
 *  rather than HTML-escaping, so the value stays valid, readable CSS instead
 *  of turning into `&quot;`. Applied to the WHOLE serialized value, not just
 *  known-quoted tokens like font-family/url, so any other token carrying a
 *  literal `"` is covered too. */
function escapeForDoubleQuotedAttr(value: string): string {
  return value.replace(/"/g, "'");
}

/** Read one token's current value off the root <html> inline style, or null
 *  when the tag/attribute/token is absent. */
export function readThemeTokenFromHtml(html: string, token: string): string | null {
  const tagMatch = HTML_TAG_RE.exec(html);
  if (!tagMatch) return null;
  const styleMatch = STYLE_ATTR_RE.exec(tagMatch[0]);
  if (!styleMatch) return null;
  return parseStyleDecls(styleMatch[1] ?? styleMatch[2] ?? "").get(token) ?? null;
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
  const decls = parseStyleDecls(styleMatch?.[1] ?? styleMatch?.[2] ?? "");

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

  const newStyleValue = escapeForDoubleQuotedAttr(serializeStyleDecls(decls));
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
