// Una superficie que invierte el modo de la página tiene que decir en qué color
// se lee su texto.
//
// El modelo pinta un panel oscuro dentro de una página clara —un CTA, una
// tarjeta destacada— y no declara `color`. El titular hereda entonces el color
// de texto de la PÁGINA, que es oscuro, y queda oscuro sobre oscuro. Medido el
// 2026-08-16 en `saas` (panel #111B30→#0E1626 sobre #F6F3EE) y en
// `physical-product-sale` (#1e1915). Ninguna reja lo ve: el contraste de la
// página está perfecto; el que falla es el del panel, y el crítico visual
// aprobó ambas.
//
// El color que se pone es `var(--ol-bg)` y no un literal: `--ol-bg` es SIEMPRE
// el polo opuesto a `--ol-fg`, así que sirve en los dos sentidos —claro sobre
// panel oscuro, oscuro sobre panel claro— y sigue a la paleta si el tema cambia
// después.

const MODEL_STYLE_RE = /<style\b[^>]*\bdata-openlen-creative(?:-section)?\s*=[^>]*>([\s\S]*?)<\/style>/gi;
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function lightness(hex: string): number | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Custom properties declared at :root, for resolving `var()` in a background. */
function rootDeclarations(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of html.matchAll(/:root\b[^{]*\{([^}]*)\}/gi)) {
    for (const decl of (block[1] ?? "").split(";")) {
      const at = decl.indexOf(":");
      if (at === -1) continue;
      const name = decl.slice(0, at).trim().toLowerCase();
      if (name.startsWith("--")) out.set(name, decl.slice(at + 1).trim());
    }
  }
  return out;
}

function resolve(value: string, decls: Map<string, string>, depth = 0): string | null {
  const v = value.trim();
  if (HEX_RE.test(v)) return v;
  if (depth >= 4) return null;
  const ref = /^var\(\s*(--[a-z0-9_-]+)/i.exec(v);
  if (!ref) return null;
  const next = decls.get(ref[1].toLowerCase());
  return next === undefined ? null : resolve(next, decls, depth + 1);
}

/**
 * Every OPAQUE colour a background value paints with. Translucent stops are
 * skipped on purpose: `rgba(255,180,84,.15)` is a veil over whatever is
 * underneath, and letting it vote turns a reading of the surface into a guess.
 */
function surfaceColors(background: string, decls: Map<string, string>): string[] {
  const out: string[] = [];
  for (const token of background.matchAll(/var\(\s*(--[a-z0-9_-]+)\s*\)|#[0-9a-f]{3,8}\b/gi)) {
    const raw = token[1] ? `var(${token[1]})` : token[0];
    // An 8-digit hex carries alpha; only a fully opaque one describes a surface.
    if (/^#[0-9a-f]{8}$/i.test(raw) && !/ff$/i.test(raw)) continue;
    const hex = resolve(raw.replace(/^(#[0-9a-f]{6})[0-9a-f]{2}$/i, "$1"), decls);
    if (hex) out.push(hex);
  }
  return out;
}

/** Splits a declaration block on `;` that are not inside parentheses, so a
 *  `linear-gradient(a, b)` is one declaration and not three. */
function declarations(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
}

export function repairInvertedSurfaces(html: string): string {
  const openTag = html.match(/<html\b[^>]*>/i)?.[0];
  if (!openTag) return html;
  const pageBg = openTag.match(/--ol-bg:\s*([^;"]*)/i)?.[1];
  const pageLight = pageBg ? lightness(pageBg) : null;
  if (pageLight === null) return html;

  const decls = rootDeclarations(html);

  return html.replace(MODEL_STYLE_RE, (sheet) =>
    sheet.replace(/(\{)([^{}]*)(\})/g, (whole, open: string, body: string, close: string) => {
      const parts = declarations(body);
      if (parts.some((d) => /^\s*color\s*:/i.test(d))) return whole;
      const background = parts.find((d) => /^\s*background(-color)?\s*:/i.test(d));
      if (!background) return whole;

      const colors = surfaceColors(background.slice(background.indexOf(":") + 1), decls);
      if (colors.length === 0) return whole;
      // Every opaque stop has to sit on the far side. One that does not means
      // the surface straddles the page's tone and we cannot say it inverts.
      const inverts = colors.every((hex) => {
        const l = lightness(hex);
        return l !== null && l < 0.5 !== pageLight < 0.5;
      });
      if (!inverts) return whole;

      return `${open}${body}${body.trim().endsWith(";") ? "" : ";"}color:var(--ol-bg)${close}`;
    }),
  );
}
