import postcss from "postcss";

const MODEL_STYLE = /<style\b([^>]*\bdata-openlen-creative(?:-section)?(?:=[^>]*)?)>([\s\S]*?)<\/style>/gi;
const COLOR_PROP = /^(color|background|background-color|border-color|border-(?:top|right|bottom|left)-color|fill|stroke|outline-color)$/i;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const DECLARED = /(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g;

function canonical(hex: string): string | null {
  const s = hex.slice(1);
  if (s.length === 3) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`.toLowerCase();
  if (s.length === 6) return `#${s}`.toLowerCase();
  if (s.length === 8) return s.slice(6).toLowerCase() === "ff" ? `#${s.slice(0, 6)}`.toLowerCase() : null;
  return null;
}

/**
 * Sólo los tokens del tema EFECTIVO, y sólo con su valor efectivo.
 *
 * El tema vive en `style=` de `<html>`, y un atributo en línea gana a cualquier
 * regla `:root` de una hoja. Cosechar cualquier declaración del documento ata
 * el literal al valor que NO se ve: medido, el marcador de dirección declara
 * `--ol-surface:#ffffff` mientras la página pinta `#FBF7EF`, y atar ahí cambia
 * el color en pantalla. Un valor que dos tokens comparten se descarta: elegir
 * uno inventaría una intención que la página no declaró.
 */
function effectiveTokens(html: string): Map<string, string> {
  const inline = /<html\b[^>]*\sstyle="([^"]*)"/i.exec(html)?.[1] ?? "";
  const byName = new Map<string, string>();
  for (const m of inline.matchAll(DECLARED)) {
    const value = canonical(m[2]!);
    if (value) byName.set(m[1]!, value);
  }
  if (byName.size === 0) return new Map();

  const byValue = new Map<string, Set<string>>();
  for (const [name, value] of byName) {
    const set = byValue.get(value) ?? new Set<string>();
    set.add(name);
    byValue.set(value, set);
  }
  const out = new Map<string, string>();
  for (const [value, names] of byValue) if (names.size === 1) out.set(value, [...names][0]!);
  return out;
}

/**
 * Devuelve al modelo el color que ya eligió, escrito como el token que vale
 * exactamente lo mismo.
 *
 * SÓLO coincidencia exacta, y sólo en las hojas del propio modelo. Medido sobre
 * 35 páginas generadas: de 837 colores a mano, el 17% es idéntico a un token de
 * la página y el 51% es un color nuevo de verdad. Reescribir los nuevos
 * cambiaría el diseño que el modelo eligió —eso sería peor que el problema—,
 * mientras que el literal idéntico es pérdida pura: se ve igual y deja a la
 * página sorda al tema. El inspector mueve el acento y media página no se entera.
 */
export function bindColorsToTokens(html: string): { html: string; bound: number } {
  const tokens = effectiveTokens(html);
  if (tokens.size === 0) return { html, bound: 0 };

  let bound = 0;
  const out = html.replace(MODEL_STYLE, (all, attrs: string, css: string) => {
    let root: postcss.Root;
    try { root = postcss.parse(css); } catch { return all; }
    let touched = false;
    root.walkRules((rule) => {
      if (/(^|\s|,):root\b/.test(rule.selector)) return;
      rule.walkDecls((decl) => {
        if (!COLOR_PROP.test(decl.prop)) return;
        const next = decl.value.replace(HEX, (hex) => {
          const name = tokens.get(canonical(hex) ?? "");
          if (!name) return hex;
          bound += 1;
          return `var(${name})`;
        });
        if (next !== decl.value) { decl.value = next; touched = true; }
      });
    });
    return touched ? `<style${attrs}>${root.toString()}</style>` : all;
  });

  return { html: out, bound };
}
