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

/**
 * ¿Este bloque es infraestructura NUESTRA en vez de código del modelo?
 *
 * Dos casos, y los dos importan: el `<script src>` del CDN de Tailwind —que es
 * la hoja de estilos disfrazada de script— y los carriers `data-ol-*` que el
 * normalizador inyecta para que el selector de tema funcione. Borrar
 * cualquiera de los dos al reemplazar el JavaScript del modelo dejaría la
 * página sin estilos o sin sus controles de tema.
 */
function esNuestro(bloque: string): boolean {
  const abre = bloque.slice(0, bloque.indexOf(">") + 1);
  return /\bsrc\s*=/i.test(abre) || /\bdata-ol-/i.test(abre);
}

/** El documento sin el JavaScript del modelo — la infraestructura se queda. */
function sinScriptsDelModelo(html: string): string {
  return html.replace(SCRIPT_RE, (bloque) => (esNuestro(bloque) ? bloque : ""));
}

/** El código que el modelo escribió en este documento, o `""`. */
export function scriptDelDocumento(html: string): string {
  for (const bloque of scriptsDe(html)) {
    if (esNuestro(bloque)) continue;
    return bloque
      .replace(/^<script\b[^>]*>/i, "")
      .replace(/<\/script>\s*$/i, "");
  }
  return "";
}

/**
 * Aplica al DOCUMENTO lo que el turno pidió hacer con su JavaScript.
 *
 * Antes esto escribía una columna: `reemplazar` construía una cápsula nueva,
 * `borrar` la vaciaba y `preservar` la re-sellaba contra los bytes nuevos. Con
 * el script dentro del documento, las tres son operaciones sobre el HTML — y
 * `preservar` deja de existir como acción, porque no hay nada que preservar:
 * el `<script>` sobrevive a las ops del turno igual que sobrevive un `<footer>`
 * que nadie tocó.
 */
export function aplicarIntentDeScript(
  html: string,
  intent: { kind: "preservar" } | { kind: "reemplazar"; code: string } | { kind: "borrar" },
): string {
  if (intent.kind === "preservar") return html;
  const limpio = sinScriptsDelModelo(html);
  if (intent.kind === "borrar") return limpio;
  const bloque = "<script>" + intent.code + "</script>";
  const i = limpio.toLowerCase().lastIndexOf("</body>");
  return i === -1 ? limpio + bloque : limpio.slice(0, i) + bloque + limpio.slice(i);
}

/**
 * TODO el JavaScript del modelo que hay en el documento, concatenado.
 *
 * `scriptDelDocumento` devuelve el PRIMER bloque y sirve para enseñárselo al
 * modelo. Esto es para PREGUNTARLE AL CÓDIGO: ¿esta clase la añade alguien en
 * caliente? Ahí un bloque no basta — una página corriente trae varios, y
 * quedarse con el primero da la misma respuesta que no mirar ninguno pero con
 * más confianza.
 *
 * La infraestructura (`<script src>` del CDN, carriers `data-ol-*`) queda
 * fuera: no es código del modelo y nadie pregunta por ella.
 */
export function todoElJsDelDocumento(html: string): string {
  return scriptsDe(html)
    .filter((bloque) => !esNuestro(bloque))
    .map((bloque) =>
      bloque.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>\s*$/i, ""),
    )
    .join("\n");
}
