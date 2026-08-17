// El tema de la página adopta la paleta que el modelo se definió al rediseñar.
//
// `bindSectionTokens` ata los tokens de los fragmentos de la BIBLIOTECA a
// `--ol-*` para que la página no quede "armada por piezas". El CSS que el
// modelo escribe en la sesión creativa nunca pasa por ahí — y no debería: el
// sandbox existe para que rediseñe. Pero entonces conviven dos paletas
// completas, la de la dirección en el `<html>` y la del modelo en el `:root`,
// y donde una sección del modelo toca un fragmento de la biblioteca se ve la
// costura (medido: cuatro negros distintos en la corrida horror-experience).
//
// Atarle el CSS al modelo lo aplanaría: si pintó `#050404` en una sección y
// `#0d0a09` en otra, eso son capas a propósito. Así que va al revés — el tema
// baja al valor del modelo y los fragmentos, que ya leen `--ol-*`, lo siguen.
// El tema es el piso, no el techo.

/** Token del modelo → token de página. Mismo vocabulario que `TOKEN_TO_OL` en
 *  lib/sections/assemble.ts, recortado a los roles cuyo desacuerdo se VE. Las
 *  fuentes no viajan: la tipografía de la dirección es una decisión y el
 *  `--serif` del modelo no es un rol, es su nombre para una familia. */
const ADOPTABLE: Record<string, string> = {
  "--bg": "--ol-bg",
  "--background": "--ol-bg",
  "--paper": "--ol-bg",
  "--surface": "--ol-surface",
  "--card": "--ol-surface",
  "--fg": "--ol-fg",
  "--ink": "--ol-fg",
  "--text": "--ol-fg",
  "--foreground": "--ol-fg",
  "--border": "--ol-border",
  "--line": "--ol-border",
  "--accent": "--ol-accent",
};

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function hexToTriplet(hex: string): string | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`;
}

/** Perceived lightness 0..1. Enough to tell a page's floor from its ceiling. */
function lightness(hex: string): number | null {
  const t = hexToTriplet(hex);
  if (!t) return null;
  const [r, g, b] = t.split(",").map((n) => Number(n.trim()) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Last literal declaration of each adoptable token across every :root block,
 *  which is the one the cascade lands on. Values already bound to `var(--ol-*)`
 *  are skipped — that is the assembler's binding, not the model's choice, and
 *  adopting it would point a token at itself. */
function modelTokens(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of html.matchAll(/:root\b[^{]*\{([^}]*)\}/gi)) {
    for (const decl of (block[1] ?? "").split(";")) {
      const at = decl.indexOf(":");
      if (at === -1) continue;
      const name = decl.slice(0, at).trim().toLowerCase();
      const value = decl.slice(at + 1).trim();
      const ol = ADOPTABLE[name];
      if (!ol || !HEX_RE.test(value)) continue;
      out.set(ol, value);
    }
  }
  return out;
}

/**
 * Rewrites the `<html>` inline `--ol-*` values to the palette the model painted
 * with. A no-op when the model defined none (the baseline shipped unchanged) or
 * when the page carries no theme to update.
 */
export function adoptModelPalette(html: string): string {
  const openTag = html.match(/<html\b[^>]*>/i)?.[0];
  if (!openTag) return html;
  const style = openTag.match(/\bstyle\s*=\s*"([^"]*)"/i);
  if (!style) return html;

  const adopted = modelTokens(html);
  if (adopted.size === 0) return html;

  // A dark page whose model background reads light (a mistake, or an injected
  // value) would turn every library fragment white under text written for
  // black. The mode the page declares is the contract; a background that
  // breaks it is not adopted, and neither is anything else in that pass.
  const bg = adopted.get("--ol-bg");
  if (bg) {
    const declaredDark = /\bclass\s*=\s*"[^"]*\bdark\b/i.test(openTag);
    const l = lightness(bg);
    if (l !== null && declaredDark !== l < 0.5) adopted.delete("--ol-bg");
  }
  if (adopted.size === 0) return html;

  const accent = adopted.get("--ol-accent");
  const triplet = accent ? hexToTriplet(accent) : null;
  // Without this every rgba(var(--ol-accent-r), …) on the page keeps mixing the
  // OLD accent — a second, invisible disagreement replacing the one we fixed.
  if (triplet) adopted.set("--ol-accent-r", triplet);

  const nextStyle = style[1]
    .split(";")
    .map((decl) => {
      const at = decl.indexOf(":");
      if (at === -1) return decl;
      const name = decl.slice(0, at).trim();
      const value = adopted.get(name);
      return value === undefined ? decl : `${name}:${value}`;
    })
    .join(";");

  return html.replace(
    openTag,
    openTag.replace(style[0], `style="${nextStyle}"`),
  );
}
