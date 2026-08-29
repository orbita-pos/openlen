// Hornea los almacenes de `lectura` DENTRO del HTML publicado.
//
// POR QUÉ. Un almacén de `lectura` —el menú, el catálogo— lo escribe el dueño y
// es el mismo para todos. Si sólo se pudiera leer por `fetch`, la página saldría
// a disco vacía: Google no indexaría los platos ni los precios, y el visitante
// vería un hueco hasta que el JS respondiera. Horneado, el documento los lleva
// dentro y la página funciona aunque el JavaScript falle.
//
// Es lo mismo que hacía `bakeCollections`, y es lo único de aquel módulo que
// valía la pena conservar — conservado como MECANISMO, no como módulo: aquí no
// hay nada que activar, sólo un marcador que el modelo deja en su HTML.
//
// `propio` y `añadir` NO se hornean nunca: son por visitante, y hornearlos sería
// servirle a todo el mundo los datos de uno. Quien filtra por modo es el
// llamador (lib/projects.ts); este fichero hornea lo que le den.

const MARCADOR_RE = (almacen: string) =>
  new RegExp(
    `(<(\\w+)[^>]*\\bdata-ol-datos=["']${almacen}["'][^>]*>)([\\s\\S]*?)(<\\/\\2>)`,
    "i",
  );

/** Nombre de almacén, tal y como lo acepta `leerDeclaracion`. Se comprueba antes
 *  de meterlo en una expresión regular: un nombre con `(` o `[` la rompería, y
 *  uno elegido a mala fe podría hacerla catastróficamente lenta. */
const NOMBRE_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function escapa(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Una fila. Los campos se pintan en el orden en que están en el documento —el
 *  que el modelo declaró— para que la página mande sobre la presentación. */
function fila(doc: Record<string, unknown>): string {
  const campos = Object.entries(doc)
    .map(([k, v]) => `<span data-ol-campo="${escapa(k)}">${escapa(v)}</span>`)
    .join("");
  return `<div data-ol-fila>${campos}</div>`;
}

export function horneaLectura(
  html: string,
  datos: Record<string, { id: string; doc: Record<string, unknown> }[]>,
): string {
  let salida = html;
  for (const [almacen, filas] of Object.entries(datos)) {
    if (!NOMBRE_RE.test(almacen)) continue;
    const re = MARCADOR_RE(almacen);
    if (!re.test(salida)) continue;
    const dentro = filas.map((f) => fila(f.doc)).join("");
    salida = salida.replace(
      re,
      (_m, abre: string, _tag: string, _viejo: string, cierra: string) =>
        `${abre}${dentro}${cierra}`,
    );
  }
  return salida;
}
