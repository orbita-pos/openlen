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

/**
 * ¿ESTE DOCUMENTO LEE ESTE TOKEN?
 *
 * POR QUÉ EXISTE. Escribir el token en `<html style>` siempre "funciona" — la
 * declaración queda puesta. Que la página CAMBIE depende de que su CSS diga
 * `var(--ol-…)` en algún sitio, y MEDIDO el 2026-08-22 sobre las 178 plantillas
 * del repo: sólo 7 lo dicen. En las otras 171 el tema se aplicaba, la
 * herramienta devolvía `ok: true, tokens_aplicados: 1` y la página se quedaba
 * exactamente igual.
 *
 * Contar tokens ESCRITOS y llamarlo éxito es la degradación que este repo
 * prohíbe: reportar un cambio que no se hizo. Esto cuenta los LEÍDOS.
 *
 * Comprobación de cadena, sin render: `var(--ol-x)` en el CSS del documento.
 * Es tonta a propósito — un `var()` dentro de una regla que nunca casa con
 * nada daría un falso positivo, pero equivocarse por optimista aquí sólo
 * cuesta un turno, y equivocarse por pesimista le quita al usuario un camino
 * que sí funcionaba.
 */
export function documentReadsToken(html: string, token: string): boolean {
  // `var(  --ol-accent )` es CSS válido; el espacio opcional no puede costar
  // un falso negativo.
  return new RegExp(`var\\(\\s*${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(html);
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

/** El nombre de familia que abre un valor de `font-family`, sin comillas.
 *  `"'Plus Jakarta Sans', sans-serif"` → `Plus Jakarta Sans`. */
export function fontFamilyName(tokenValue: string): string | null {
  const primera = tokenValue.split(",")[0]?.trim() ?? "";
  const limpia = primera.replace(/^["']|["']$/g, "").trim();
  // Sólo familias con nombre. Un `serif` o `sans-serif` genérico no se carga de
  // ningún sitio, y pedirle a Google una hoja para "serif" da un 400.
  if (!limpia || /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+)$/i.test(limpia)) {
    return null;
  }
  return /^[A-Za-z0-9 ]{1,40}$/.test(limpia) ? limpia : null;
}

/**
 * La hoja de Google Fonts que hace falta para que la fuente EXISTA.
 *
 * MEDIDO el 2026-08-22: ni `cambiar_tema` ni el inspector del iframe añadían
 * nunca el `<link>`. Así que poner `--ol-font-display: 'Fraunces', serif` en
 * una página que no carga Fraunces no cambiaba la tipografía — el navegador
 * caía al `serif` del sistema y el usuario veía Times New Roman donde pidió una
 * editorial. Los kits de temáticas sí lo hacen (`lib/tematicas/presets.ts`);
 * el camino de tema plano se había quedado a medias.
 *
 * Devuelve el html intacto cuando la familia ya está cargada, cuando es
 * genérica, o cuando no hay `<head>` donde ponerla.
 */
export function ensureFontLink(html: string, tokenValue: string): string {
  const familia = fontFamilyName(tokenValue);
  if (!familia) return html;
  const paraUrl = familia.replace(/ /g, "+");
  // Ya cargada (por el <link> de Google o por un @font-face propio): no se
  // duplica. Se mira el nombre con `+` y con espacio porque las dos formas
  // aparecen en las plantillas.
  if (html.includes(`family=${paraUrl}`) || html.includes(`family=${familia}`)) return html;
  const i = html.toLowerCase().lastIndexOf("</head>");
  if (i === -1) return html;
  // Pesos 400 y 700: el cuerpo y el titular. Pedir la variable completa engorda
  // la descarga y el horneado al publicar la deja local de todos modos.
  const link = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${paraUrl}:wght@400;700&display=swap">`;
  return html.slice(0, i) + link + html.slice(i);
}
