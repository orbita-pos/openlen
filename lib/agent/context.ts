// lib/agent/context.ts — builds the per-turn context block the agent route
// injects as the first user message (state + brief + what the owner selected), plus
// buildAgentMessages, the single message-assembly path both the route AND the
// eval harness (F3 Task 6) consume so a turn is byte-identical either way.
//
// Pure string building, zero I/O, zero native imports — the caller feeds it
// server-read state (summarizeProjectState); this module just formats. Len 2.0
// no recibe el documento: lo lee con Read (plans/len-2/ficheros-plan.md, T8c). Keeping it import-free of
// @/lib/html-engine (native) and @/lib/db lets context.test.ts run under
// vitest without the native bindings being loadable. buildAgentSystemPrompt
// (from catalog) is pure TS too — no native — so importing it here keeps that
// invariant.

// Cache effect: [system, manual, …history] is the cached prefix, rebuilt byte for byte from the saved transcripts; what changes each turn (memory changes, context, the request) goes last; pruning under pressure cuts in jumps (A7).

import { todayLine } from "@/lib/ai/today-line";
import { LOCALE_ENGLISH_NAMES } from "@/lib/publish/publish-locales";
import type { Message } from "@/lib/ai-gateway";
import { buildAgentSystemPrompt } from "@/lib/agent/catalog";
import { adjuntoDelManual, buildManualDeLaPlataforma } from "@/lib/agent/manual-de-la-plataforma";
import type { AgentMode } from "@/lib/agent/dynamis";
import type { AppDeProyecto } from "@/lib/projects/types";
import { notaDeLaFoto, textoDelHistorial, type MensajeDelHistorial } from "@/lib/agent/transcripcion";
import { PERSONAL_LEN_MD } from "@/lib/agent/ficheros/len-md";
import { REGLA_DEL_EQUIPO } from "./equipo";

/**
 * El bloque para el prompt, o `""` cuando no hay nada.
 *
 * `""` importa: sin memoria, el contexto sale BYTE A BYTE como antes de que
 * esto existiera — ningún proyecto paga tokens por una capacidad que no usa,
 * y la caché de prefijo no se invalida para quien nunca guardó nada.
 */
export function userMemoryBlock(memoria: string | null | undefined, ruta?: string): string {
  const v = memoria?.trim();
  if (!v) return "";
  // En inglés desde la traducción de lo que lee Len (2026-10-02), también para
  // Crear y el Chat, que lo comparten: decisión de Jesús.
  return `WHAT YOU KNOW ABOUT THIS PERSON ${ruta ? `— ${ruta} ` : ""}(their private instructions, on ANY of their pages — it isn't about this project, it's about them${ruta ? "; edit this file to change them" : ""}):
${v}
Respect it without them having to repeat it. If something here clashes with what they ask TODAY, today wins and you don't argue: the memory is a starting point, not a rule over them.
It belongs to the person speaking now: in a shared project each person has their own, so never quote it to anyone else on the project.

`;
}

/** Un cambio ya hecho, tal como lo cuenta el registro de versiones. */
export interface CambioHecho {
  label: string;
  page: string | null;
  createdAt: Date;
}

/** Cuántos cambios se enseñan. Con una docena el modelo ya puede contestar
 *  «¿qué le hemos hecho a esta página?» sin inventar; más allá es relleno que
 *  se paga en cada turno. */
const MAX_CAMBIOS = 12;

/**
 * EL REGISTRO DE CAMBIOS — lo que el Agente HIZO, no lo que se dijo.
 *
 * POR QUÉ EXISTE. `projectVersions` guarda CADA edición con su etiqueta ya
 * escrita en español («Agente (1 ops): Actualizar el título del hero a
 * "Taller El Norte — desde 1998"») y nadie se la enseñaba al modelo. MEDIDO el
 * 2026-08-22: preguntándole «hazme una lista de todos los cambios que le has
 * hecho hoy» acertó 5 de 7 — reconstruyéndolos de la conversación, o sea que
 * los dos que se le cayeron eran los que quedaron fuera de la ventana.
 *
 * Esto es MEJOR que ampliar la ventana, y por eso va primero: el registro
 * sobrevive a cualquier tope, a recargar, a cerrar el navegador y a volver un
 * mes después. La conversación no.
 *
 * Es un HECHO, no una interpretación: cada línea existe porque una edición se
 * guardó de verdad. Si el modelo dijo que hizo algo y no está aquí, no lo hizo.
 */
export function changelogBlock(cambios: readonly CambioHecho[]): string {
  if (cambios.length === 0) return "";
  const linea = (c: CambioHecho) =>
    `- ${c.label}${c.page ? ` (page "${c.page}")` : ""}`;
  return `

WHAT HAS ALREADY BEEN DONE TO THIS PAGE (the real version log, most recent first — not the conversation: the changes that were actually saved):
${cambios.slice(0, MAX_CAMBIOS).map(linea).join("\n")}
Use it to answer "what have we done?" without making things up, and to avoid repeating a change that is already made. If something you thought you did does NOT appear here, it never got saved.

`;
}

/** GIT (spec local 2026-10-15-git-for-len, §5): the git status block, as `gitStatusForTurn`
 *  wrote it, after the change log and what the owner changed by hand. */
export function gitStatusBlock(text: string | null | undefined): string {
  return text ? `${text}\n\n` : "";
}

/**
 * LO QUE EL DUEÑO CAMBIÓ A MANO desde el último turno de Len en esta página.
 *
 * Las líneas ya vienen redactadas (`lib/agent/cambios-del-dueno.ts`): el texto
 * de antes y el de ahora. Va con el registro de cambios porque contesta la otra
 * mitad de su pregunta: aquél dice lo que se guardó, esto dice lo que la página
 * tiene ahora y no escribió Len. Sin esto, su historial decía «puse el titular
 * X» y la página decía Y — y a «¿qué cambió?» se atribuía lo que hizo el dueño.
 */
export function cambiosDelDuenoBlock(lineas: readonly string[]): string {
  if (lineas.length === 0) return "";
  return `THE OWNER CHANGED THE PAGE BY HAND since your last change to it — you did NOT do this:
${lineas.map((l) => `- ${l}`).join("\n")}
Respect what they put: the files already have it. If your conversation says otherwise, the page wins. And if they ask what changed, this is what the user changed, not you.

`;
}

/** Una pérdida ya registrada en la fila del proyecto. Forma mínima a
 *  propósito: esto se formatea, no se interpreta. */
export interface DegradacionConocida {
  code: string;
  detail?: readonly string[];
}

/** Cuántas se le enseñan. Ocho es lo que ya usa el Chat; más es una lista que
 *  el modelo hojea en vez de leer. */
const MAX_DEGRADACIONES = 8;

/**
 * LO QUE LA PÁGINA YA PERDIÓ, y el Agente no sabía.
 *
 * El diagnóstico existía completo —el atributo, la fórmula literal, qué falta y
 * qué hacer— y se guardaba en `data.degradations[].detail`. El Chat ya lo
 * recibe (`KNOWN ISSUES ON THIS PAGE`); el Agente no lo veía por ningún lado.
 * Así que quien escribía «los botones no funcionan» arrancaba una conversación
 * a ciegas sobre un fallo que el sistema tenía diagnosticado por escrito.
 *
 * Sólo viajan las que traen `detail`: un código a secas («scripts, 12») no le
 * dice al modelo qué tocar, y ya se le cuenta al usuario por otra vía.
 */
export function degradacionesBlock(
  degradaciones: readonly DegradacionConocida[],
): string {
  const lineas = degradaciones
    .flatMap((d) => (d.detail ?? []).map((t) => `- [${d.code}] ${t}`))
    .slice(0, MAX_DEGRADACIONES);
  if (lineas.length === 0) return "";
  return `WHAT IS ALREADY KNOWN TO BE BROKEN ON THIS PAGE (recorded at ingestion; the user may be describing it to you in other words):
${lineas.join("\n")}

`;
}

/**
 * LOS AVISOS POR TURNO, y por qué NO viven en el bloque de contexto.
 *
 * Son dos: lo que la ingestión ya sabe roto en esta página y la lista de
 * progreso que salió del historial. Los dos hablan del turno que está pasando
 * AHORA.
 *
 * ⚰️ Había un tercero, el aviso de turno mudo («NOTICE: your previous turn did
 * NOT call any tool… apply it NOW»), retirado el 2026-10-17 con la insistencia
 * de `loop.ts`. MEDIDO con DeepSeek V4.1 Flash y un historial cuyo último turno
 * fue una pregunta contestada con palabras: no evitó ningún «Listo» falso (sin
 * él, 10 de 10 editaron) y sí hizo que Len desconfiara de su propio historial y
 * releyera la página (8 de 10 contra 1 de 10). Claude Code no tiene nada así.
 *
 * Vivían al principio del bloque de contexto — por delante del documento, del
 * estado y del brief —, o sea a unos 35.000 caracteres del punto donde el
 * modelo empieza a generar. Un aviso sobre el turno inmediato, enterrado
 * detrás de todo el documento.
 *
 * Ahora se cuelgan del final del mensaje del usuario, detrás de sus palabras,
 * que es donde OpenCode cuelga los suyos (`reminders.ts:28-35`, reaplicados en
 * cada step por `prompt.ts:1180-1184`) y donde su prompt base avisa de que esos
 * bloques existen y mandan (`default.txt:78`).
 *
 * VAN MARCADOS. Pegados a la petición sin marca, el modelo los lee como parte
 * de lo que le pidió el usuario y contesta al aviso en vez de al encargo. La
 * marca es la misma que ya usa `loop.ts` para lo mismo.
 *
 * Y si no hay ninguno devuelve la cadena vacía: una capacidad que no se usa no
 * cuesta un byte, y el turno limpio queda byte a byte como estaba.
 */
export function avisosDelTurno(args: {
  degradaciones?: readonly DegradacionConocida[];
  /** La lista de progreso que salió del historial (`todosForTurn`). */
  todoRestore?: string | null;
}): string {
  const roto = degradacionesBlock(args.degradaciones ?? []);
  const lista = args.todoRestore ? `${args.todoRestore}\n\n` : "";
  if (!roto && !lista) return "";
  return `

SYSTEM (the user did NOT write this):
${roto}${lista}`;
}

/**
 * LO QUE EL DUEÑO SEÑALÓ EN EL LIENZO, como lo recibe Claude Code (texto nuestro).
 *
 * En Claude Code, cuando el usuario selecciona líneas en su IDE, el modelo
 * recibe dentro de un `<system-reminder>` qué líneas de qué fichero eligió, su
 * texto (cortado a 2.000 caracteres) y el aviso de que puede tener que ver o no
 * con la tarea. Len 2.0 edita ficheros, así que el pin del
 * lienzo llega igual: fichero y líneas, que puede ir a leer y editar.
 *
 * Las líneas las ancla la ruta (`etiquetarConPosiciones` + el resolvedor del
 * motor). Cuando no se puede anclar, Claude Code no tiene caso —en un IDE
 * siempre hay líneas—; aquí se dice lo que se sabe (el fichero y la pista del
 * lienzo) sin inventar números. Decisión nuestra, dicha en voz alta.
 */
export type SeleccionDelDueno =
  | { readonly ruta: string; readonly desde: number; readonly hasta: number; readonly contenido: string }
  | { readonly ruta: string; readonly pista: string };

/** El mismo tope de caracteres que Claude Code pone a una selección. */
const TOPE_DE_SELECCION = 2000;

export function seleccionBlock(sel: SeleccionDelDueno | null | undefined): string {
  if (!sel) return "";
  const cuerpo =
    "desde" in sel
      ? `On the canvas, the user pointed at lines ${sel.desde}-${sel.hasta} of ${sel.ruta}:\n${
          sel.contenido.length > TOPE_DE_SELECCION
            ? `${sel.contenido.slice(0, TOPE_DE_SELECCION)}\n[cut here]`
            : sel.contenido
        }`
      : `On the canvas, the user pointed at an element of ${sel.ruta}: ${sel.pista}`;
  return `<system-reminder>\n${cuerpo}\n\nIt may or may not matter for what you are doing now.\n</system-reminder>\n\n`;
}

/** Una foto del mensaje, como la ve el contexto: `visible` = sus píxeles van
 *  pegados al mensaje y el modelo PUEDE VERLA. */
export interface AttachedImageForContext {
  readonly url: string;
  readonly alt?: string;
  readonly visible?: boolean;
}

/**
 * VARIAS FOTOS EN UN MENSAJE (Crear es Len, 2026-10-06). Lo que decía Crear de
 * sus referencias (`app/api/generate/route.ts`, «ATTACHED REFERENCES») junto
 * con lo que dice Len de una foto suelta: aquí SÍ tienen dirección, así que las
 * que pertenecen a la página se colocan, y las de inspiración sólo se miran.
 * Las etiquetas («Image 1…») son las que pone `withImages` en
 * `lib/ai/fireworks-stream-client.ts` a las que llegan con píxeles.
 */
function attachedImagesBlock(imagenes: readonly AttachedImageForContext[]): string {
  const lineas = imagenes
    .map((f, i) => `Image ${i + 1}: ${f.url}${f.alt ? ` (alt text: ${f.alt})` : ""}`)
    .join("\n");
  const vistas = imagenes.filter((f) => f.visible).length;
  const seeLine =
    vistas === imagenes.length
      ? "\nThey are ATTACHED to this turn, labeled in that order, and you CAN SEE THEM."
      : vistas > 0
        ? `\n${vistas} of them are ATTACHED to this turn and you CAN SEE THEM; of the rest you only have the address.`
        : "";
  return `IMAGES ATTACHED BY THE USER (${imagenes.length}), in this order:\n${lineas}${seeLine}
They are NOT the same idea cut into pieces and they are NOT averaged. Usually each one brings something different —a logo, the premises or the product, a mood board—. Read them ONE BY ONE and take from each what only it tells you; if two contradict each other, the user's message wins, and if it doesn't settle it, Image 1 wins.
The ones that belong ON the page (a logo, the premises, a product) are REAL image URLs the user attached on purpose — place each one using its EXACT URL (verbatim) as the src of an <img> (or as a CSS background-image), with alt text true to what it shows. A mood board is for looking at, not for inserting. NEVER make up or change a URL, and DON'T TALK ABOUT the addresses: OpenLen's uploader wrote them, they work in the editor and they are baked in when publishing, even if they start with localhost. Don't refuse and don't replace them with placeholders.\n\n`;
}

export function buildAgentContext(args: {
  /** El proyecto tiene miembros: la regla del chat del equipo va delante.
   *  Ausente/false ⇒ contexto BYTE-idéntico al de antes del chat del equipo. */
  equipo?: boolean;
  /** Inyectable sólo para las pruebas: sin esto el bloque HOY cambiaría cada
   *  día y ninguna prueba podría fijarlo. */
  now?: Date;
  /** La zona del usuario (IANA): el HOY es SU día, no el de UTC. */
  zona?: string;
  /** El idioma de la interfaz del usuario (`es`, `pt`…), el que manda el panel. */
  idioma?: string;
  /** LOS VISUALES (spec local 2026-10-16-len-inline-visuals): si la persona lee
   *  en un teléfono, lo que manda el panel. Sin él, o `desktop`, nada cambia. */
  dispositivo?: "mobile" | "desktop";
  /** El idioma en que ESCRIBE (`userWritingLanguage`). Si lo hay, se nombra
   *  éste y no el de la interfaz. */
  writingLanguage?: string | null;
  state: Record<string, unknown>;
  /** Lo que el Agente sabe de la PERSONA — sobrevive a cambiar de proyecto.
   *  Ausente/vacio ⇒ contexto BYTE-identico al de antes de que existiera. */
  userMemory?: string | null;
  /** Los cambios que ya se guardaron (projectVersions). Ausente/vacío ⇒ salida
   *  byte-idéntica. */
  cambios?: readonly CambioHecho[];
  /** Lo que el dueño cambió a mano desde el último turno de Len en esta página
   *  (H07). Ausente/vacío ⇒ salida byte-idéntica. */
  cambiosDelDueno?: readonly string[];
  /** GIT (spec local 2026-10-15-git-for-len, §5): Claude Code's git status block for this turn
   *  (`lib/git/status-block.ts`). Absent/null ⇒ byte-identical output. */
  gitStatus?: string | null;
  artifactIndex?: string | null;
  /** Lo que la ingestión registró como perdido (`data.degradations`).
   *  Ausente/vacío ⇒ salida byte-idéntica. */
  degradaciones?: readonly DegradacionConocida[];
  // ⚰️ Aquí iba `userBrief` (el PROJECT BRIEF de /memoria/proyecto.md). Desde
  // plans/len-md el /LEN.md del proyecto es un MENSAJE DURADERO de la
  // conversación, como en DeepSeek (`memoryMessage` de buildAgentMessages).
  /** F2 Task 8 — the user attached an image this turn (same shape the route
   *  validates in ai-design: real http(s) URL, optional alt). Present ⇒ the
   *  model is told to place it with Edit using the URL verbatim, replacing a
   *  placeholder if one exists. Absent/omitted ⇒ no block.
   *  F5 — `visible: true` means the route ALSO attached the image's pixels to
   *  the first model turn (inlineData), so the block tells the model it can
   *  actually SEE the image, not just its URL.
   *  Crear es Len (2026-10-06) — hasta 4 por mensaje (`MAX_PHOTOS_PER_MESSAGE`).
   *  Con UNA, el bloque es byte a byte el de siempre. */
  attachedImages?: readonly AttachedImageForContext[] | null;
  /** Lo que el dueño señaló en el lienzo. Ver `SeleccionDelDueno`. */
  seleccion?: SeleccionDelDueno | null;
  /** EL MODO DISEÑO de una app: el bloque de `designBlock` (lib/agent/design-block.ts), o nada. */
  design?: string | null;
  // ⚰️ `styleDirection` (26/10): el bloque `<visual-direction>` de la ficha de
  // una URL, con lo que un modelo de visión vio en esa web. Una URL es ahora
  // texto del mensaje y Len la mira cuando decide (`view_page` con `url`).
}): string {
  let imageBlock = "";
  const imagenes = args.attachedImages ?? [];
  if (imagenes.length > 1) {
    imageBlock = attachedImagesBlock(imagenes);
  } else if (imagenes.length === 1) {
    const attachedImage = imagenes[0]!;
    const altLine = attachedImage.alt ? `\nAlt text: ${attachedImage.alt}` : "";
    // F5: cuando los píxeles viajan adjuntos al turno, díselo — puede diseñar
    // CON la imagen (colores, orientación, contenido) en vez de colocarla a
    // ciegas. Sin visible, el texto queda byte-idéntico a F2 (pinned).
    const seeLine = attachedImage.visible
      ? `\nThe image is ATTACHED to this turn and you CAN SEE IT: use it to decide where and how to place it — match the palette and the layout to its colors, orientation and content, and write an alt that is true to what it shows.`
      : "";
    imageBlock = `IMAGE ATTACHED BY THE USER: ${attachedImage.url}${altLine}${seeLine}\nThis is a REAL image URL that the user attached on purpose — place it using this EXACT URL (verbatim) as the src of an <img> (or as a CSS background-image). NEVER make up or change the URL. And DON'T TALK ABOUT IT: OpenLen's uploader wrote it, it works in the editor and it is baked in when publishing. There is nothing to warn about, not even if it starts with localhost. Don't refuse, don't replace it with a placeholder, and DON'T ask them to upload it again "some other way" — it is the same uploader and it would give the same address. Place it and talk about the DESIGN, not the address. If the page already has a placeholder for this image (a <div> with a gradient, an empty box with a border), REPLACE that whole element with the <img> — don't nest it inside. Always include alt text (use the user's if they gave one; if not, infer it from the context).\n\n`;
  }

  // El modelo no sabe qué día es, y eso no es cosmético: pidiéndole una cuenta
  // regresiva "dentro de tres semanas" escribió una fecha DOS MESES ANTERIOR a
  // hoy, y el contador nace vencido en la página del usuario.
  //
  // El día lo dice `todayLine`, que es la única fuente para todas las
  // superficies. La regla de "posterior a hoy" se queda aquí: es del Agente,
  // porque lo que él escribe son plazos que nacen vencidos.
  const hoy = `${todayLine(args.now, args.zona).trimEnd()} Also: any date you write (countdowns, events, deadlines) has to be AFTER today, unless the user explicitly asks for a past one.\n\n`;

  // EL IDIOMA, POR SU NOMBRE (ensayo de caja del 09/10). Con «el idioma de su
  // petición» sólo en el prompt, en un turno largo —el manual, el estado y las
  // salidas de los comandos delante, todo en inglés— Len narró sus pasos en
  // inglés a un dueño que escribía en español; sólo el cierre salió bien. Como
  // el `language` de Claude Code: el idioma nombrado, para todo lo que lee el
  // usuario; el código, como está. Y su mensaje sigue mandando si escribe en otro.
  //
  // Y EL QUE ESCRIBE, ANTES QUE EL DE LA INTERFAZ (Holi, 10/10): con la interfaz
  // en inglés y escribiendo en español, «the user's interface is in English» le
  // ganó a su mensaje y Len contestó en inglés. Si se sabe en qué escribe
  // (`userWritingLanguage`), se nombra ése; el de la interfaz, si no se sabe.
  const nombreQueEscribe = args.writingLanguage ? LOCALE_ENGLISH_NAMES[args.writingLanguage] : undefined;
  const nombreDelIdioma = args.idioma ? LOCALE_ENGLISH_NAMES[args.idioma] : undefined;
  const idiomaBlock = nombreQueEscribe
    ? `LANGUAGE: the user writes in ${nombreQueEscribe}. Everything they read goes in ${nombreQueEscribe} —or in the language of their message, if they switch—: the notes between your steps as much as your final answer. Code, file names and identifiers stay as they are.\n\n`
    : nombreDelIdioma
      ? `LANGUAGE: the user's interface is in ${nombreDelIdioma}. Everything they read goes in the language of their message —${nombreDelIdioma} unless they write in another—: the notes between your steps as much as your final answer. Code, file names and identifiers stay as they are.\n\n`
      : "";
  // LOS VISUALES: `read_me` pide la plataforma; en un teléfono, Len lo sabe.
  const dispositivoBlock = args.dispositivo === "mobile" ? "DEVICE: the user is reading on a phone (about 360px wide).\n\n" : "";

  // ⚰️ EL AVISO DE QUE NO LO VE TODO y LAS PALABRAS QUE SE CAYERON (H08-a) se
  // fueron con A11: Len ve la charla entera desde el último resumen, como Claude
  // Code, así que no hay turnos perdidos que avisar ni frases que rescatar.
  // H3 — con su ruta, como Claude Code mete cada CLAUDE.md con la suya; ya
  // cuenta como leído (`memoriaSembrada`). Sólo lo PERSONAL va aquí: es de
  // quien habla y la conversación es compartida (plans/len-md). El /LEN.md del
  // proyecto es el mensaje duradero (`memoryMessage`).
  const memoriaBlock = userMemoryBlock(args.userMemory, PERSONAL_LEN_MD);
  // ⚰️ AQUÍ IBA EL DOCUMENTO: la página activa con un `data-op-id` en cada
  // elemento, delante de todo; o, con un pin, sólo su sección más un índice del
  // resto; o, si no cabía, sólo el índice (el «plano B»), con `leer_estado
  // op_id=` para abrir secciones. Len 2.0 edita el sitio como ficheros
  // (plans/len-2/ficheros-plan.md, T8c): lo lee con Read —entero, por trozos o
  // buscando con Grep—, igual que Claude Code, que no recibe los ficheros
  // pegados al mensaje. Qué ficheros hay y cuál tiene abierto el dueño va en el
  // ESTADO (`ficheros`, `abierta_en_el_editor`).
  return `${args.equipo ? REGLA_DEL_EQUIPO : ""}${memoriaBlock}${hoy}${idiomaBlock}${dispositivoBlock}PROJECT STATE (real, read from the server just now):\n${JSON.stringify(args.state, null, 2)}\n\n${seleccionBlock(args.seleccion)}${args.design ?? ""}${imageBlock}${changelogBlock(args.cambios ?? [])}${cambiosDelDuenoBlock(args.cambiosDelDueno ?? [])}${gitStatusBlock(args.gitStatus)}${args.artifactIndex ? `${args.artifactIndex}\n` : ""}`;
}


/** Rough chars→tokens estimate (~3.5 chars/token on tag-dense HTML + JSON),
 *  used as a pre-flight size guard before the route ships a turn upstream. */
export function estimateContextTokens(userContent: string, systemPrompt: string): number {
  return Math.ceil((userContent.length + systemPrompt.length) / 3.5);
}

/** Lo que cuenta una foto de la conversación para el techo: el TOPE por imagen
 *  de DeepSeek V4.1 (su calculadora publicada, en el arnés de DeepSeek:
 *  `image-tokens.ts`, `MAX_IMAGE_TOKENS`). Cuadra con lo medido en Fireworks el
 *  2026-10-01: 945 una foto de 1672×941; una de 800 px, ~280. */
export const TOKENS_POR_FOTO = 1_024;

/** A7 · cada cuánto pensado acumulado hay un corte posible al podar bajo
 *  presión, como fracción del techo: un salto quita al menos esto, y el turno
 *  siguiente no vuelve a podar hasta que el historial crezca otro tanto. */
export const TRAMO_DE_LO_PENSADO = 0.1;

export interface BuildAgentMessagesArgs {
  /** Ver buildAgentContext.equipo. */
  equipo?: boolean;
  // ⚰️ Aquí iba `diferidas`: los nombres de las herramientas diferidas (H2),
  // anunciados en un `<system-reminder>` para cargarlas con ToolSearch. Se
  // retiraron con ToolSearch en Len 2.1 (2026-09-30): todo va cargado.
  /** summarizeProjectState(...) output — the caller computes it (it needs the
   *  DB row); this module stays free of @/lib/agent/tools' native imports. */
  state: Record<string, unknown>;
  /** El modo del turno (`lib/agent/dynamis.ts`): en Dynamis, el prompt y el
   *  manual se dicen con la terminal sola. Ausente = Len. */
  mode?: AgentMode;
  /** LA TERMINAL REAL: si la terminal de este turno es la caja (`realTerminalFor`
   *  el dueño); el manual lo dice como bash. Ausente = si lo sería para cualquiera. */
  realTerminal?: boolean;
  /** UNA APP WEB (`project.data.app`): el prompt y el manual son los suyos
   *  (`lib/agent/modo-app.ts`). Ausente = una página. */
  app?: AppDeProyecto | null;
  /** La zona del usuario (IANA), la misma de `AgentSession.zonaHoraria`: el HOY
   *  del contexto es SU día (plans/len-resultados/diseno.md §7). */
  zona?: string;
  /** El idioma de la interfaz (ver buildAgentContext.idioma). */
  idioma?: string;
  /** Si lee en un teléfono (ver buildAgentContext.dispositivo). */
  dispositivo?: "mobile" | "desktop";
  /** Ver buildAgentContext.writingLanguage. */
  writingLanguage?: string | null;
  /** Ver `avisosDelTurno.todoRestore`. */
  todoRestore?: string | null;
  /** Ver buildAgentContext.userMemory. */
  userMemory?: string | null;
  /** Ver buildAgentContext.cambios. */
  cambios?: readonly CambioHecho[];
  /** Ver buildAgentContext.cambiosDelDueno. */
  cambiosDelDueno?: readonly string[];
  /** GIT (spec local 2026-10-15-git-for-len, §5): Claude Code's git status block for this turn
   *  (`lib/git/status-block.ts`). Absent/null ⇒ byte-identical output. */
  gitStatus?: string | null;
  artifactIndex?: string | null;
  /** Ver buildAgentContext.degradaciones. */
  degradaciones?: readonly DegradacionConocida[];
  /**
   * LEN.md (plans/len-md): el mensaje de memoria del PROYECTO de este turno
   * —línea base o refresco, `lib/agent/memory/memory-messages.ts`—, o nada si
   * no cambió. Va como su propio mensaje justo antes del contexto, y la ruta
   * lo guarda en la transcripción para reponerlo en su sitio: así lo de
   * delante sigue en caché, como en DeepSeek.
   */
  memoryMessage?: string | null;
  /** The user's turn prompt (already trimmed/validated by the caller). */
  prompt: string;
  /** Prior turns, ALREADY hardened to {role, content} + capped by the caller
   *  (the route slices to 36 + 4000 chars). */
  history: readonly MensajeDelHistorial[];
  attachedImages?: readonly AttachedImageForContext[] | null;
  /** Ver buildAgentContext.seleccion. */
  seleccion?: SeleccionDelDueno | null;
  /** EL MODO DISEÑO de una app: el bloque de `designBlock` (lib/agent/design-block.ts), o nada. */
  design?: string | null;
  /** Pre-flight size ceiling; over it (A11) → `compactFirst`: the loop summarizes first. */
  maxPromptTokens: number;
}

export type BuildAgentMessagesResult =
  | {
      ok: true;
      messages: Message[];
      systemPrompt: string;
      contextBlock: string;
      /** Los avisos del turno, tal y como van detrás de las palabras del dueño:
       *  la ruta los guarda con el turno y el historial los repone en su sitio. */
      avisos: string;
      /** A11 · ni sin lo pensado cabe: el bucle resume ANTES de la primera
       *  llamada de trabajo (`compactFirst`), como Claude Code al recibir tu
       *  mensaje. Antes era `too_large` → 413 y el turno no empezaba. */
      compactFirst?: true;
    };

// ⚰️ Aquí vivía `PETICION_DEL_USUARIO` («WHAT THE USER ASKS YOU NOW:»), la
// costura entre el contexto y las palabras del dueño cuando iban en UN mensaje.
// Desde el 2026-10-06 van en dos, como DeepSeek: la costura es el mensaje.

/** Assemble the exact message array an agent turn ships upstream: system
 *  prompt, the prior history, then the context block (state + brief +
 *  optional selection/image blocks) in its own user message, and LAST the
 *  user's own words (plus the turn's marked notices). Shared by app/api/agent/route.ts and the eval harness so a
 *  turn is byte-identical whichever entry point built it. Applies the same
 *  pre-flight size guard the route used inline (413 on overflow).
 *
 *  NO SE FABRICA UN TURNO DE ASSISTANT. Hubo uno durante meses —
 *  `Entendido. Tengo el estado y el documento. ¿Qué hacemos?`— sentado en la
 *  última posición antes de generar: prosa charlatana, acabada en pregunta,
 *  sin una sola llamada a herramienta. Es el sitio de más peso del turno y lo
 *  gastábamos enseñándole a CONTESTAR en vez de a ACTUAR. Fabricar turnos no
 *  es el pecado en sí (OpenCode fabrica dos: `prompt.ts:1279-1282` y
 *  `transform.ts:285-296`); el pecado era fabricar la conducta equivocada.
 *
 *  Y el contexto va JUNTO a la petición, al final del array, no colgando
 *  antes del historial: es el punto de generación, y es donde la tarea 4
 *  necesita poder colgar los avisos por turno.
 *
 *  🔴 PERO EN SU PROPIO MENSAJE, como DeepSeek (su contexto de entorno es otro
 *  mensaje: `agent.ts`, `runtimeContext.project`) y Claude Code. Pegados, la
 *  petición era la cola de un bloque en inglés, y en el primer turno de un
 *  proyecto Len empezaba a narrar en inglés a un dueño que escribía en español
 *  (ensayo de caja de crear-es-len, 06/10). El último mensaje es el del dueño:
 *  ahí van también sus fotos (la ruta) y, marcados, los avisos del turno. */
export function buildAgentMessages(args: BuildAgentMessagesArgs): BuildAgentMessagesResult {
  const systemPrompt = buildAgentSystemPrompt(process.env, args.mode, args.app ?? null);
  const contextBlock = buildAgentContext({
    equipo: args.equipo,
    zona: args.zona,
    idioma: args.idioma,
    dispositivo: args.dispositivo,
    writingLanguage: args.writingLanguage,
    state: args.state,
    userMemory: args.userMemory,
    cambios: args.cambios,
    cambiosDelDueno: args.cambiosDelDueno,
    gitStatus: args.gitStatus,
    artifactIndex: args.artifactIndex,
    degradaciones: args.degradaciones,
    attachedImages: args.attachedImages,
    seleccion: args.seleccion,
    design: args.design,
  });
  const avisos = avisosDelTurno({
    degradaciones: args.degradaciones,
    todoRestore: args.todoRestore,
  });
  // H4: con los resultados enteros en el historial, el techo cuenta también las
  // llamadas y sus respuestas, no sólo el texto (ver `textoDelHistorial`).
  const historyText = textoDelHistorial(args.history);
  // EL MANUAL DE LA PLATAFORMA (/AGENTS.md, paso 7 de 2.5): lo adjunta el arnés
  // justo después del prompt de sistema, como Claude Code sus ficheros de
  // instrucciones. No cambia entre peticiones, así que va en el prefijo fijo y
  // se lee de caché; el contexto, que sí cambia, sigue en el último mensaje.
  const manual = adjuntoDelManual(buildManualDeLaPlataforma(process.env, args.mode, args.app ?? null, args.realTerminal));
  // Los avisos cuentan para el techo: son parte del turno, no un extra que
  // aparece después de haber decidido que cabía. El manual también.
  // Y las fotos (A): viajan pegadas a su mensaje en todas las vueltas, así que
  // ocupan contexto como en Claude Code. La del turno cuenta si se vio.
  const fotos = args.history.reduce((n, m) => n + (m.images?.length ?? 0), 0) + (args.attachedImages ?? []).filter((f) => f.visible).length;
  // 🔴 LA NOTA DE CADA FOTO, YA EN ESTE TURNO (Len 3.1, escena «photo-turn»): el
  // historial la pone detrás de tu mensaje (`mensajeDelDueno`), así que si este
  // turno la mandaba sin ella, el siguiente dejaba de coincidir con la caché del
  // proveedor desde tu mensaje y pagaba el turno entero otra vez. Como Claude
  // Code, que anota la imagen pegada en el mismo mensaje en que se pega.
  const peticion = turnRequestText({ prompt: args.prompt, avisos, attachedImages: args.attachedImages });
  const fijo = manual + (args.memoryMessage ?? "") + contextBlock + peticion;
  const cabe = (caracteresDelHistorial: number) =>
    Math.ceil((fijo.length + caracteresDelHistorial + systemPrompt.length) / 3.5) + fotos * TOKENS_POR_FOTO <=
    args.maxPromptTokens;
  // 🔴 H15 fase 2 (02/10): CON PRESIÓN, SE VA PRIMERO LO PENSADO MÁS VIEJO. Lo
  // pensado de turnos anteriores vuelve en el historial (como en el arnés de
  // DeepSeek) y cuenta para el techo. Si no cabe, antes de rechazar el turno se
  // le quita a los mensajes más viejos, uno a uno: es lo que hace la compactación
  // de DeepSeek, cuyo resumen guarda el texto y deja fuera el razonamiento. El
  // mensaje se queda; sólo pierde lo pensado. Si ni así cabe, `too_large` como
  // siempre. La cuenta es lineal (`estimateContextTokens`): quitar lo pensado
  // baja el historial en su longitud más el salto que lo separa.
  //
  // 🔴 A7 de Len 3.1 (25/10): Y A SALTOS, como el microcompact. Antes se quitaba
  // justo lo que hacía falta, así que cada turno cerca del techo quitaba uno más:
  // el corte se movía y cada turno pagaba otra vez el historial desde ahí. Los
  // cortes posibles salen sólo de los mensajes viejos —cada `TRAMO_DE_LO_PENSADO`
  // de lo pensado acumulado— y se usa el primero con el que cabe: mientras el
  // historial crezca sin pasar del siguiente, el corte no se mueve y el prefijo
  // sigue en caché.
  let caracteres = historyText.length;
  let history = args.history;
  if (!cabe(caracteres)) {
    const tramo = Math.max(1, Math.floor(args.maxPromptTokens * 3.5 * TRAMO_DE_LO_PENSADO));
    const cortes: number[] = [];
    let acumulado = 0;
    args.history.forEach((m, i) => {
      if (!m.reasoning) return;
      acumulado += m.reasoning.length;
      // Un pensado muy largo puede pasar de varios tramos a la vez: un corte por tramo.
      while (acumulado >= (cortes.length + 1) * tramo) cortes.push(i);
    });
    // El último salto: todo lo pensado.
    cortes.push(args.history.length - 1);
    for (const corte of cortes) {
      let quitado = 0;
      const podado = args.history.map((m, i) => {
        if (i > corte || !m.reasoning) return m;
        quitado += m.reasoning.length + 1;
        const { reasoning: _quitado, ...sinPensar } = m;
        return sinPensar;
      });
      caracteres = historyText.length - quitado;
      history = podado;
      if (cabe(caracteres)) break;
    }
  }
  const compactFirst = !cabe(caracteres);
  const messages = assembleTurnMessages({
    systemPrompt,
    manual,
    history,
    memoryMessage: args.memoryMessage,
    contextBlock,
    prompt: peticion,
  });
  return { ok: true, messages, systemPrompt, contextBlock, avisos, ...(compactFirst ? { compactFirst: true as const } : {}) };
}

/** Tu mensaje de este turno tal y como viaja: lo que pides, sus avisos y la nota
 *  de cada foto, en el orden en que el historial lo rehará (`mensajeDelDueno`). */
export function turnRequestText(o: {
  readonly prompt: string;
  readonly avisos: string;
  readonly attachedImages?: readonly AttachedImageForContext[] | null;
}): string {
  const notas = (o.attachedImages ?? []).map((f) => notaDeLaFoto(f, f.visible ? "vista" : "no-cargo"));
  return `${o.prompt}${o.avisos}${notas.length > 0 ? `\n\n${notas.join("\n")}` : ""}`;
}

/**
 * EL ORDEN DE LA PETICIÓN DE UN TURNO, en un solo sitio: [sistema, manual,
 * …historial, memoria, contexto, petición]. Lo usa `buildAgentMessages` y lo
 * usan las escenas reales de Len 3.1 (`lib/agent/replay-scenes/`), que
 * reconstruyen turnos de producción con las MISMAS piezas: si el orden cambia
 * aquí, cambia en las dos. `prompt` ya lleva los avisos detrás.
 */
export function assembleTurnMessages(o: {
  readonly systemPrompt: string;
  readonly manual: string;
  readonly history: readonly MensajeDelHistorial[];
  readonly memoryMessage?: string | null;
  readonly contextBlock: string;
  readonly prompt: string;
}): Message[] {
  return [
    { role: "system", content: o.systemPrompt },
    { role: "user", content: o.manual },
    ...o.history,
    ...(o.memoryMessage ? [{ role: "user" as const, content: o.memoryMessage }] : []),
    { role: "user", content: o.contextBlock },
    { role: "user", content: o.prompt },
  ];
}
