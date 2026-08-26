/**
 * LOS `<script>` NO VIENEN DEL NAVEGADOR: SE EMPALMAN DESDE LO GUARDADO.
 *
 * EL PROBLEMA. El editor guarda serializando el DOM VIVO
 * (`captureClean` en use-inline-edit.ts manda `document.documentElement
 * .outerHTML`). Ese cuerpo llega por la red desde el navegador del usuario, así
 * que es entrada NO FIABLE y `PATCH /html` la sanea — lo cual borra los
 * `<script>`. Con el código del modelo viviendo dentro del documento, eso
 * significaba que la primera edición de un titular mataba el carrito.
 *
 * LA TENTACIÓN, Y POR QUÉ NO. Dejar de sanear ese cuerpo abriría la puerta a
 * que cualquiera haga un PATCH con el `<script>` que le dé la gana y lo
 * publique bajo un subdominio nuestro. La entrada del navegador se sanea. Punto.
 *
 * LA SOLUCIÓN. El marcado editado viene del navegador; los `<script>` vienen
 * del documento que ya estaba GUARDADO. Es un empalme determinista: no hay
 * hash que cuadrar, no hay nada que invalidar, y es incapaz de introducir
 * código nuevo porque el código sale de la base, no de la petición.
 *
 * Es la misma idea que tenía la cápsula —el código no lo pone quien edita—
 * pero sin la parte que se rompía: la cápsula ataba el código a unos bytes
 * exactos y cualquier edición la desajustaba. Esto no ata nada.
 *
 * ⚠️ NO EJECUTAR MIENTRAS SE EDITA. Esto resuelve la mitad de guardar. La otra
 * mitad la resuelve `modelJsShouldRun` (live-preview-modes.ts): con el script
 * corriendo, el DOM que se serializa lleva el estado que el script dejó — un
 * reloj en 24:30, un filtro que escondió media rejilla. Mirando, la página está
 * viva; editando, es un documento.
 */

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script>/gi;

/** Los bloques `<script>…</script>` completos, en orden de aparición. */
function scriptsDe(html: string): string[] {
  return html.match(SCRIPT_RE) ?? [];
}

/**
 * `editado` con los `<script>` de `guardado` restaurados antes de `</body>`.
 *
 * Sólo se restauran los que NO estén ya presentes byte a byte: el CDN de
 * Tailwind sobrevive al saneador (está en su lista blanca), así que sin esta
 * comprobación acabaría dos veces en el documento.
 *
 * Sin `</body>` se pegan al final. Un documento así ya pasó por el
 * normalizador, de modo que es un caso que no debería existir; perder los
 * scripts en silencio sería peor que ponerlos donde el navegador los lee igual.
 */
export function conservarScripts(guardado: string, editado: string): string {
  const previos = scriptsDe(guardado);
  if (previos.length === 0) return editado;

  const yaEstan = new Set(scriptsDe(editado));
  const faltan = previos.filter((s) => !yaEstan.has(s));
  if (faltan.length === 0) return editado;

  const bloque = faltan.join("");
  const i = editado.toLowerCase().lastIndexOf("</body>");
  return i === -1 ? editado + bloque : editado.slice(0, i) + bloque + editado.slice(i);
}
