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
 * lo que sólo hace falta a veces —la guía de diseño y las librerías— vive en
 * /.openlen/docs y se lee cuando hace falta, como las
 * habilidades de DeepSeek y de Claude Code (un catálogo corto, el texto a
 * demanda). No es una herramienta `Skill`: Flash no carga lo diferido
 * (ToolSearch, 2 llamadas en 958 turnos), y leer un fichero sí lo hace bien.
 *
 * Tres propiedades, las mismas para los cuatro ficheros:
 *   · Read los abre por su ruta, con terminal o sin ella;
 *   · Grep y Glob NO los ven: así un Grep de `createClient` o de un teléfono
 *     encuentra la página, no los ejemplos del manual;
 *   · Edit, Write y la terminal los rechazan, y el rechazo dice dónde sí se
 *     escribe.
 * No se publican: la publicación sólo lleva páginas.
 *
 * El texto se monta en `lib/agent/manual-de-la-plataforma.ts`; esto es sólo lo
 * que necesitan las herramientas, sin nada pesado detrás. Puro.
 */

// Efecto en la caché: va justo detrás del prompt de sistema, en el prefijo fijo; sólo cambia con el modo (página o app) o con la terminal real, y entonces se paga todo una vez.

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
export const RUTA_LIBRERIAS = `${CARPETA_DOCS}/librerias.md`;
// ⚰️ Aquí iban RUTA_API_D (`api-d.md`, data-ol-stores) y RUTA_ACCOUNTS
// (`accounts.md`, data-ol-accounts), retiradas el 2026-10-04: los datos y la
// gente que entra en una página son su backend de Supabase.
/** Cómo se construye una app (F4 de la spec local 2026-10-07-apps): en una
 *  PÁGINA, para cuando el dueño acepta convertirla (`convert_to_app`). Es el
 *  manual de una app; en una app ya es su /AGENTS.md y no hace falta aquí. */
export const RUTA_APPS = `${CARPETA_DOCS}/apps.md`;
export const RUTAS_DE_DOCS: readonly string[] = [RUTA_GUIA, RUTA_LIBRERIAS, RUTA_APPS];

/** Las skills de Len (spec local 2026-10-26-len-skills): de la plataforma como
 *  /.openlen/docs. `Read` lee sus ficheros de apoyo (el `forms.md` de `pdf`), como
 *  Claude Code los de una skill; sin esto, sólo los veía la terminal (27/10). */
export const CARPETA_SKILLS = "/.openlen/skills";

/** Los manuales que pasaron a ser skills (spec local 2026-10-27-len-five-skills, §4.2), con las
 *  skills encendidas: la ruta vieja → la skill. Una charla de antes los pide por la ruta vieja, y
 *  `Read` le dice adónde se mudaron, como las rutas viejas de la memoria. */
export const RUTAS_MUDADAS: Readonly<Record<string, string>> = {
  [RUTA_GUIA]: "frontend-design",
  [RUTA_LIBRERIAS]: "frontend-design",
  [RUTA_APPS]: "convert-to-app",
  ...Object.fromEntries(
    ["dashboard", "slides", "image", "motion", "audio"].map((kind) => [`${CARPETA_DOCS}/artifacts/${kind}.md`, `artifact-${kind}`]),
  ),
};

export function mudanza(ruta: string, skill: string): string {
  return `${ruta} moved to the skill "${skill}": load it with the skill tool, or read ${CARPETA_SKILLS}/${skill}/SKILL.md.`;
}

/** ¿Es del manual de la plataforma (de sólo lectura, no se publica)? Toda la
 *  carpeta, no sólo sus tres ficheros: un `nuevo.md` ahí tampoco se escribe. */
export function esDeLaPlataforma(ruta: string): boolean {
  return ruta === RUTA_MANUAL || ruta.startsWith(`${CARPETA_DOCS}/`) || ruta.startsWith(`${CARPETA_SKILLS}/`);
}

/** El rechazo de Edit, Write y la terminal, en el idioma de los errores de las herramientas. */
export const MANUAL_SOLO_LECTURA = `${RUTA_MANUAL}, ${CARPETA_DOCS} and ${CARPETA_SKILLS} are OpenLen's platform manual and skills: read-only and never published. To keep something the user wants remembered, write it in ~/.len/LEN.md (the person) or /LEN.md (this project); a skill of the user's own goes in /.len/skills/<name>/SKILL.md.`;

// El envoltorio del adjunto. Hasta F4 era el de Claude Code palabra por
// palabra; el repo es público, así que se dice con palabras propias y el mismo
// peso: estas instrucciones mandan sobre lo que haría por defecto, y no hay que
// contestarle al mensaje en sí (ver la memoria de la rama len-2).
export const PRINCIPIO_DEL_ADJUNTO = `<system-reminder>
Platform instructions for this conversation, written by OpenLen. You must follow them as written: they take precedence over your general habits.

${RUTA_MANUAL} (the platform manual, managed by OpenLen; read-only):`;

export const CIERRE_DEL_ADJUNTO = `Not all of this applies to every request: use what bears on the task, and do not reply to this message on its own.
</system-reminder>`;

/** ¿Es este mensaje el manual que adjunta el arnés? (no lo dijo el usuario). */
export function esAdjuntoDelManual(contenido: string): boolean {
  return contenido.startsWith(PRINCIPIO_DEL_ADJUNTO);
}
