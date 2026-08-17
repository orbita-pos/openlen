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

/** Token del modelo → token de página, para los roles que `body` no expresa.
 *
 * `--ol-bg` y `--ol-fg` NO están acá a propósito: salen sólo de lo que `body`
 * pinta. Un nombre es una suposición sobre el vocabulario del modelo, y una
 * suposición equivocada en esos dos roles es texto invisible. Medido, no
 * temido: una corrida declaró `--ink:#050505` y pintó
 * `body{background:var(--ink)}` con él — `--ink` significa por convención el
 * color del TEXTO, así que la tabla lo habría entregado como `--ol-fg` y la
 * página habría nacido negro sobre negro. Se salvó porque esa corrida además
 * declaraba `body{color:…}`, que corre después y tapó el error.
 *
 * Las fuentes tampoco viajan: la tipografía de la dirección es una decisión, y
 * el `--serif` del modelo no es un rol sino su nombre para una familia. */
const ADOPTABLE: Record<string, string> = {
  "--surface": "--ol-surface",
  "--card": "--ol-surface",
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

/** Every custom property declared at :root, last-wins, values verbatim. */
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

/** Follow `var(--x)` to the literal it ends at. Returns null if the chain runs
 *  into an --ol-* token (that is the assembler's binding, not the model's
 *  choice), loops, or ends anywhere that is not a hex colour. */
function resolveColor(value: string, decls: Map<string, string>): string | null {
  let v = value.trim();
  for (let hop = 0; hop < 4; hop++) {
    if (HEX_RE.test(v)) return v;
    const ref = /^var\(\s*(--[a-z0-9_-]+)/i.exec(v);
    if (!ref) return null;
    const name = ref[1].toLowerCase();
    if (name.startsWith("--ol-")) return null;
    const next = decls.get(name);
    if (next === undefined) return null;
    v = next.trim();
  }
  return null;
}

/** What `body` actually paints, resolved through the model's own token names.
 *
 * The name table below only fires when the model happens to use a conventional
 * name. Measured on the second horror run: it called its tokens `--um-bg` /
 * `--um-bone` (UM for UMBRAL) and invents the prefix per page, so name-matching
 * missed it and the seam shipped anyway (#070505 under var(--ol-bg) #09090B).
 * The rule the model cannot rename is which declaration paints the page. */
function bodyPaints(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const decls = rootDeclarations(html);
  for (const rule of html.matchAll(/(^|[\s},;])body\s*\{([^}]*)\}/gi)) {
    for (const decl of (rule[2] ?? "").split(";")) {
      const at = decl.indexOf(":");
      if (at === -1) continue;
      const prop = decl.slice(0, at).trim().toLowerCase();
      const ol = prop === "background" || prop === "background-color"
        ? "--ol-bg"
        : prop === "color"
          ? "--ol-fg"
          : null;
      if (!ol) continue;
      const literal = resolveColor(decl.slice(at + 1), decls);
      if (literal) out.set(ol, literal);
    }
  }
  return out;
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

  // Names first (they carry surface/border/accent, which body cannot), then
  // what body paints — that one wins, because it is the page's actual floor and
  // the only signal the model cannot rename out from under us.
  const adopted = modelTokens(html);
  for (const [token, value] of bodyPaints(html)) adopted.set(token, value);
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
