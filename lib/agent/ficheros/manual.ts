/**
 * /AGENTS.md Y /.openlen/docs — EL MANUAL DE LA PLATAFORMA (paso 7 de Len 2.5; F4 de
 * plans/len-agente-2026), como ficheros.
 *
 * Es el fichero de instrucciones «gestionado» de Claude Code: el que pone la
 * organización, que puede no existir en disco y que el usuario no edita. Aquí
 * lo pone OpenLen: cómo funciona la plataforma y sus contratos. Se llama
 * AGENTS.md porque es el nombre que Claude Code ya lee como instrucciones de
 * proyecto.
 *
 * F4: /AGENTS.md se queda con lo que vale para cualquier edición y un índice;
 * lo que sólo hace falta a veces —la guía de diseño, el contrato de /api/d y
 * las librerías— vive en /.openlen/docs y se lee cuando hace falta, como las
 * habilidades de DeepSeek y de Claude Code (un catálogo corto, el texto a
 * demanda). No es una herramienta `Skill`: Flash no carga lo diferido
 * (ToolSearch, 2 llamadas en 958 turnos), y leer un fichero sí lo hace bien.
 *
 * Tres propiedades, las mismas para los cuatro ficheros:
 *   · Read los abre por su ruta, con terminal o sin ella;
 *   · Grep y Glob NO los ven: así un Grep de `data-ol-stores` o de un teléfono
 *     encuentra la página, no los ejemplos del manual;
 *   · Edit, Write y la terminal los rechazan, y el rechazo dice dónde sí se
 *     escribe.
 * No se publican: la publicación sólo lleva páginas.
 *
 * El texto se monta en `lib/agent/manual-de-la-plataforma.ts`; esto es sólo lo
 * que necesitan las herramientas, sin nada pesado detrás. Puro.
 */

export const RUTA_MANUAL = "/AGENTS.md";

/**
 * La carpeta de lo que se lee a demanda (F4). OCULTA, como `/.openlen/` de F5 y
 * el `.git` de un repo: MEDIDO en el humo de la tanda dev 31 (02/10), un
 * `grep -rn … /` de Len encontraba el manual y tenía que filtrarlo a mano, y el
 * grep y el rg de just-bash no entran en carpetas ocultas (`find` y `ls -a`
 * sí). Lo de la plataforma no es del proyecto: en DeepSeek y en Claude Code
 * vive fuera de su árbol. La ficha decía `/docs`; se movió por ese dato.
 */
export const CARPETA_DOCS = "/.openlen/docs";
export const RUTA_GUIA = `${CARPETA_DOCS}/guia-de-diseno.md`;
export const RUTA_API_D = `${CARPETA_DOCS}/api-d.md`;
export const RUTA_LIBRERIAS = `${CARPETA_DOCS}/librerias.md`;
export const RUTAS_DE_DOCS: readonly string[] = [RUTA_GUIA, RUTA_API_D, RUTA_LIBRERIAS];

/** ¿Es del manual de la plataforma (de sólo lectura, no se publica)? Toda la
 *  carpeta, no sólo sus tres ficheros: un `nuevo.md` ahí tampoco se escribe. */
export function esDeLaPlataforma(ruta: string): boolean {
  return ruta === RUTA_MANUAL || ruta.startsWith(`${CARPETA_DOCS}/`);
}

/** El rechazo de Edit, Write y la terminal, en el idioma de los errores de las herramientas. */
export const MANUAL_SOLO_LECTURA = `${RUTA_MANUAL} and ${CARPETA_DOCS} are OpenLen's platform manual: read-only and never published. To keep something the user wants remembered, add it to /memoria/dueno.md or /memoria/proyecto.md.`;

// El envoltorio del adjunto. Hasta F4 era el de Claude Code palabra por
// palabra; el repo es público, así que se dice con palabras propias y el mismo
// peso: estas instrucciones mandan sobre lo que haría por defecto, y no hay que
// contestarle al mensaje en sí (memoria `la-rama-len-2-lleva-textos-del-binario`).
export const PRINCIPIO_DEL_ADJUNTO = `<system-reminder>
Platform instructions for this conversation, written by OpenLen. You must follow them as written: they take precedence over your general habits.

${RUTA_MANUAL} (the platform manual, managed by OpenLen; read-only):`;

export const CIERRE_DEL_ADJUNTO = `Not all of this applies to every request: use what bears on the task, and do not reply to this message on its own.
</system-reminder>`;

/** ¿Es este mensaje el manual que adjunta el arnés? (no lo dijo el usuario). */
export function esAdjuntoDelManual(contenido: string): boolean {
  return contenido.startsWith(PRINCIPIO_DEL_ADJUNTO);
}
