// El vocabulario del modelo, aislado del de la biblioteca.
//
// `bindSectionTokens` reescribe las DECLARACIONES de un fragmento de biblioteca
// para que apunten a `--ol-*`, y lo hace scopeado a `[data-sec="…"]`. El modelo
// después escribe su propio CSS con sus propios nombres. Cuando elige uno que la
// biblioteca ata —midido: `--ink`, que significa TEXTO para ella y FONDO para
// él— las dos declaraciones caen sobre el MISMO <section>, y la del elemento
// tapa la de `:root`. El modelo pidió `#050505` y recibió el color de la letra.
//
// Arbitrar rompe a alguno de los dos: sacar la atadura deja el texto del
// fragmento en el negro del modelo, sobre fondo oscuro. Así que la colisión no
// se arbitra, se elimina — lo que el modelo declara pasa a un prefijo propio,
// dentro de sus propias hojas. La biblioteca conserva su significado y el
// modelo el suyo, sin negociar.

const PREFIX = "--olm-";

/** Las hojas que escribió el modelo: la de página y una por sección. */
const MODEL_STYLE_RE = /<style\b[^>]*\bdata-openlen-creative(?:-section)?\s*=[^>]*>([\s\S]*?)<\/style>/gi;

/** `--nombre:` en posición de declaración. */
const DECL_RE = /(^|[{;\s])(--[a-z0-9_-]+)\s*:/gi;

function isOwn(name: string): boolean {
  // `--ol-*` es el tema de la página: el modelo puede LEERLO, y si lo declara
  // eso es una anulación deliberada que `adoptModelPalette` ya interpreta.
  // `--olm-*` ya está aislado — renombrarlo otra vez rompería la idempotencia.
  return !name.startsWith("--ol-") && !name.startsWith(PREFIX);
}

/** Nombres que el modelo DECLARA en sus propias hojas. Sólo esos se renombran:
 *  un `var(--line)` que usa sin declarar es de la biblioteca, y reescribirlo lo
 *  dejaría apuntando a nada. */
function declaredByModel(html: string): Set<string> {
  const names = new Set<string>();
  for (const sheet of html.matchAll(MODEL_STYLE_RE)) {
    for (const decl of (sheet[1] ?? "").matchAll(DECL_RE)) {
      const name = decl[2].toLowerCase();
      if (isOwn(name)) names.add(name);
    }
  }
  return names;
}

/**
 * Prefixes every custom property the model declared, in the model's stylesheets
 * only — declarations and `var()` uses alike. A no-op when the model wrote no
 * CSS, and idempotent, so it can run on a document that already passed through.
 */
export function isolateModelTokens(html: string): string {
  const owned = declaredByModel(html);
  if (owned.size === 0) return html;

  // Longest first: renaming `--ink` before `--ink-2` would corrupt the latter.
  const pattern = new RegExp(
    `(--(?:${[...owned]
      .map((n) => n.slice(2))
      .sort((a, b) => b.length - a.length)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")})\\b)`,
    "gi",
  );

  return html.replace(MODEL_STYLE_RE, (sheet) =>
    sheet.replace(pattern, (name) => `${PREFIX}${name.slice(2)}`),
  );
}
