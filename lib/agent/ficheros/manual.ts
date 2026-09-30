/**
 * /AGENTS.md — EL MANUAL DE LA PLATAFORMA (paso 7 de Len 2.5), como fichero.
 *
 * Es el fichero de instrucciones «gestionado» de Claude Code:
 * el que pone la organización (`type: "Managed"`, «de la organización»), que puede no existir en disco —si viene de la configuración
 * de la organización entra con su ruta y `contentDiffersFromDisk`— y que el
 * usuario no edita. Aquí lo pone OpenLen: cómo funciona la plataforma, sus
 * contratos y la guía de diseño. Se llama AGENTS.md porque es el nombre que
 * Claude Code ya lee como instrucciones de proyecto.
 *
 * Tres propiedades, y las tres salen de ahí:
 *   · Read lo abre por su ruta, como cualquier fichero;
 *   · Grep y Glob NO lo ven: el gestionado de Claude Code vive fuera del
 *     proyecto, y así un Grep de `data-ol-stores` o de un teléfono encuentra la
 *     página, no los ejemplos del manual;
 *   · Edit y Write lo rechazan, y el rechazo dice dónde sí se escribe.
 * No se publica: la publicación sólo lleva páginas.
 *
 * El texto se monta en `lib/agent/manual-de-la-plataforma.ts`; esto es sólo lo
 * que necesitan las herramientas, sin nada pesado detrás. Puro.
 */

export const RUTA_MANUAL = "/AGENTS.md";

/** El rechazo de Edit y Write, en el idioma de los errores de las herramientas. */
export const MANUAL_SOLO_LECTURA = `${RUTA_MANUAL} is OpenLen's platform manual: it is read-only and is never published. To keep something the user wants remembered, add it to /memoria/dueno.md or /memoria/proyecto.md.`;

// El envoltorio de Claude Code: el `<system-reminder>` del contexto del usuario, con la entrada
// de los CLAUDE.md —que es donde carga también los AGENTS.md— y su frase de
// cabecera. La etiqueta de tipo es la nuestra: la suya para el gestionado es
// « (de la organización)».
const CABECERA =
  "….";
const ETIQUETA = " (platform instructions, managed by OpenLen; read-only)";

export const PRINCIPIO_DEL_ADJUNTO = `<…:
# manual
${CABECERA}

Contents of ${RUTA_MANUAL}${ETIQUETA}:`;

/** ¿Es este mensaje el manual que adjunta el arnés? (no lo dijo el usuario). */
export function esAdjuntoDelManual(contenido: string): boolean {
  return contenido.startsWith(PRINCIPIO_DEL_ADJUNTO);
}
