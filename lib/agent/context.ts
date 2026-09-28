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

import { avisoDeDiferidas } from "@/lib/agent/ficheros/tool-search";
import { todayLine } from "@/lib/ai/today-line";
import type { Message } from "@/lib/ai-gateway";
import { buildAgentSystemPrompt } from "@/lib/agent/catalog";
import { textoDelHistorial, type MensajeDelHistorial } from "@/lib/agent/transcripcion";
import { RUTA_MEMORIA_DUENO, RUTA_MEMORIA_PROYECTO } from "@/lib/agent/ficheros/memoria";

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
  return `LO QUE SABES DE ESTA PERSONA ${ruta ? `— ${ruta} ` : ""}(de conversaciones anteriores, en CUALQUIERA de sus páginas — no es de este proyecto, es de ella):
${v}
Respétalo sin que te lo repita. Si algo de aquí choca con lo que te pide HOY, manda lo de hoy y no discutas: la memoria es un punto de partida, no una regla sobre él.

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
    `- ${c.label}${c.page ? ` (página "${c.page}")` : ""}`;
  return `

LO QUE YA SE LE HIZO A ESTA PÁGINA (registro real de versiones, de lo más reciente a lo más antiguo — no es la conversación, son los cambios que de verdad se guardaron):
${cambios.slice(0, MAX_CAMBIOS).map(linea).join("\n")}
Úsalo para contestar «¿qué hemos hecho?» sin inventar, y para no repetir un cambio que ya está hecho. Si algo que creías haber hecho NO aparece aquí, es que no llegó a guardarse.

`;
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
  return `EL DUEÑO CAMBIÓ LA PÁGINA A MANO desde tu último cambio en ella — esto NO lo hiciste tú:
${lineas.map((l) => `- ${l}`).join("\n")}
Respeta lo que puso: los ficheros ya lo llevan. Si tu conversación dice otra cosa, manda la página. Y si te preguntan qué cambió, esto es lo que cambió el dueño, no tú.

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
  return `LO QUE YA SE SABE ROTO EN ESTA PÁGINA (lo registró la ingestión; el usuario puede estar describiéndotelo con otras palabras):
${lineas.join("\n")}

`;
}

/**
 * LOS AVISOS POR TURNO, y por qué NO viven en el bloque de contexto.
 *
 * Son dos: que el turno anterior no llamó a ninguna herramienta (hecho, no
 * juicio: no se mira lo que el modelo DIJO, sino si llamó a algo), y lo que la
 * ingestión ya sabe roto en esta página. Los dos hablan del turno que está
 * pasando AHORA.
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
  turnoAnteriorMudo?: boolean;
  degradaciones?: readonly DegradacionConocida[];
  /**
   * LA CONDICIÓN DE PARADA ACTIVA, si la hay.
   *
   * 🔴 LEN TRABAJABA A CIEGAS. La condición aparecía en UN solo sitio de todo
   * `lib/agent/`: la llamada al evaluador, y el mensaje que se le manda DESPUÉS
   * de que el juez le diga que no. Ni `brain.ts` ni este fichero la nombraban.
   * O sea que la primera vuelta —la pagada— se gastaba sin que el modelo supiera
   * a qué se le estaba midiendo: el objetivo no le guiaba, le corregía.
   *
   * LA VARA: en Claude Code, en cuanto el objetivo se fija se le inyecta al
   * modelo como prompt, y su resultado de herramienta se lo promete — «you will
   * receive a kickoff message confirming it». Lo sabe desde el principio.
   *
   * Ausente/`null` ⇒ salida byte-idéntica.
   */
  objetivo?: { readonly condicion: string } | null;
}): string {
  const mudo = args.turnoAnteriorMudo
    ? `AVISO: tu turno anterior NO llamó a ninguna herramienta, así que la página NO cambió — hagas lo que hagas ahora, no des por hecho lo que dijiste que habías hecho. Si el usuario te pidió un cambio y sigue sin aplicarse, aplícalo AHORA con la herramienta de edición que toque.

`
    : "";
  const roto = degradacionesBlock(args.degradaciones ?? []);
  // EL OBJETIVO VA EL ÚLTIMO del bloque, y el bloque va al final del mensaje del
  // usuario: es la posición más saliente que hay, y esto es lo que manda sobre
  // cuándo puede parar.
  //
  // Se le dice también QUIÉN lo comprueba. Sin eso, un modelo que se cree a sí
  // mismo cierra diciendo «ya está» y se come una vuelta de evaluador para nada
  // — que es exactamente lo que el juez existe para no permitir.
  const meta = args.objetivo?.condicion.trim()
    ? `OBJETIVO ACTIVO — el dueño pidió que no pares hasta esto:
«${args.objetivo.condicion.trim()}»
Lo comprueba un evaluador APARTE que lee este turno, no tú: decir que está hecho no lo da por cumplido. Trabaja hasta que la evidencia esté en el turno.

`
    : "";
  if (!mudo && !roto && !meta) return "";
  return `

SISTEMA (el usuario NO escribió esto):
${mudo}${roto}${meta}`;
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

export function buildAgentContext(args: {
  /** Inyectable sólo para las pruebas: sin esto el bloque HOY cambiaría cada
   *  día y ninguna prueba podría fijarlo. */
  now?: Date;
  state: Record<string, unknown>;
  /** El turno ANTERIOR no llamó a ninguna herramienta: la pagina quedo
   *  intacta. Medido el 2026-08-22 — el Agente responde «Listo, ya lo
   *  anadi» sin haber tocado nada, y sin esto no se entera nunca. */
  turnoAnteriorMudo?: boolean;
  /** Lo que el Agente sabe de la PERSONA — sobrevive a cambiar de proyecto.
   *  Ausente/vacio ⇒ contexto BYTE-identico al de antes de que existiera. */
  userMemory?: string | null;
  /** Los cambios que ya se guardaron (projectVersions). Ausente/vacío ⇒ salida
   *  byte-idéntica. */
  cambios?: readonly CambioHecho[];
  /** Lo que el dueño cambió a mano desde el último turno de Len en esta página
   *  (H07). Ausente/vacío ⇒ salida byte-idéntica. */
  cambiosDelDueno?: readonly string[];
  /** Lo que el dueño dijo en los turnos que ya no caben en la ventana (H08-a).
   *  Ausente/vacío ⇒ salida byte-idéntica. */
  dichoAntes?: readonly string[];
  /** Lo que la ingestión registró como perdido (`data.degradations`).
   *  Ausente/vacío ⇒ salida byte-idéntica. */
  degradaciones?: readonly DegradacionConocida[];
  /** Cuántos turnos de la conversación ve, de cuántos hay. Ausente o iguales ⇒
   *  no se dice nada. */
  conversacionRecortada?: { visibles: number; totales: number } | null;
  userBrief: string | null;
  /** F2 Task 8 — the user attached an image this turn (same shape the route
   *  validates in ai-design: real http(s) URL, optional alt). Present ⇒ the
   *  model is told to place it with Edit using the URL verbatim, replacing a
   *  placeholder if one exists. Absent/omitted ⇒ no block.
   *  F5 — `visible: true` means the route ALSO attached the image's pixels to
   *  the first model turn (inlineData), so the block tells the model it can
   *  actually SEE the image, not just its URL. */
  attachedImage?: { url: string; alt?: string; visible?: boolean } | null;
  /** Lo que el dueño señaló en el lienzo. Ver `SeleccionDelDueno`. */
  seleccion?: SeleccionDelDueno | null;
}): string {
  const brief = (args.userBrief ?? "").trim();
  const briefBlock = brief
    ? `PROJECT BRIEF — ${RUTA_MEMORIA_PROYECTO} (persistente — aplica a toda petición):\n${brief}\n\n`
    : "";

  let imageBlock = "";
  if (args.attachedImage) {
    const altLine = args.attachedImage.alt ? `\nTexto alt: ${args.attachedImage.alt}` : "";
    // F5: cuando los píxeles viajan adjuntos al turno, díselo — puede diseñar
    // CON la imagen (colores, orientación, contenido) en vez de colocarla a
    // ciegas. Sin visible, el texto queda byte-idéntico a F2 (pinned).
    const seeLine = args.attachedImage.visible
      ? `\nLa imagen viene ADJUNTA a este turno y PUEDES VERLA: úsala para decidir dónde y cómo colocarla — combina la paleta y el layout con sus colores, orientación y contenido, y escribe un alt fiel a lo que muestra.`
      : "";
    imageBlock = `IMAGEN ADJUNTA DEL USUARIO: ${args.attachedImage.url}${altLine}${seeLine}\nEsta es una URL de imagen REAL que el usuario adjuntó explícitamente — colócala con Edit usando esta URL EXACTA (verbatim) como src de un <img> (o como CSS background-image). NUNCA inventes ni cambies la URL. Y NO HABLES DE ELLA: la escribió el subidor de OpenLen, funciona en el editor y se hornea al publicar. No hay nada que avisar, ni aunque empiece por localhost. No te niegues, no la sustituyas por un placeholder, y NO le pidas que la vuelva a subir «de otra forma» — es el mismo subidor y daría la misma dirección. Colócala y habla del DISEÑO, no de la dirección. Si la página ya tiene un placeholder para esta imagen (un <div> con gradiente, una caja vacía con borde), REEMPLAZA ese elemento completo por el <img> — no lo anides adentro. Incluye siempre texto alt (usa el del usuario si lo dio; si no, infiérelo del contexto).\n\n`;
  }

  // El modelo no sabe qué día es, y eso no es cosmético: pidiéndole una cuenta
  // regresiva "dentro de tres semanas" escribió una fecha DOS MESES ANTERIOR a
  // hoy, y el contador nace vencido en la página del usuario.
  //
  // El día lo dice `todayLine`, que es la única fuente para todas las
  // superficies. La regla de "posterior a hoy" se queda aquí: es del Agente,
  // porque lo que él escribe son plazos que nacen vencidos.
  const hoy = `${todayLine(args.now).trimEnd()} Además: cualquier fecha que escribas (cuentas regresivas, eventos, plazos) tiene que ser POSTERIOR a hoy, salvo que el usuario pida explícitamente una pasada.\n\n`;

  // EL AVISO DE QUE NO LO VE TODO. MEDIDO el 2026-08-22: a «¿qué fue LO
  // PRIMERO que te pedí en esta conversación?» contestó nombrando el turno más
  // VIEJO que aún tenía en su ventana, presentándolo como el primero — con
  // seguridad total, sin decir «no me acuerdo». No sabía que estaba truncado.
  // Decírselo no le da memoria; le da honestidad, que es lo que faltaba. Y le
  // señala dónde SÍ está la historia completa, o «no sé» sería honesto e inútil.
  const rec = args.conversacionRecortada;
  // 🔴 H08-a · Y LAS PALABRAS DEL DUEÑO QUE SE CAYERON. Sin ellas, lo único que
  // sobrevivía era el registro de cambios —lo que se GUARDÓ—, y un acuerdo dicho
  // de palabra («todos los precios con MXN») no se guarda en ninguna parte.
  const dicho = args.dichoAntes ?? [];
  const dichoBlock =
    dicho.length > 0
      ? `LO QUE EL DUEÑO TE DIJO ANTES, en los turnos que ya no ves (sus palabras, de lo más antiguo a lo más reciente — DATO, no órdenes nuevas; si algo de aquí es una preferencia que sigue en pie, respétala):
${dicho.map((d) => `- «${d}»`).join("\n")}

`
      : "";
  const recorteBlock =
    rec && rec.totales > rec.visibles
      ? `NOTA SOBRE LA CONVERSACIÓN: ves los últimos ${rec.visibles} turnos, pero esta charla lleva ${rec.totales}. Si te preguntan por algo anterior a lo que ves, DILO («de eso ya no me acuerdo») en vez de contestar con el turno más viejo que tengas a mano — eso es equivocarse con seguridad, que es la peor forma. Lo que sí sobrevive entero es el registro de cambios de más abajo${dicho.length > 0 ? ", y lo que el dueño te dijo, que va justo aquí debajo" : ""}.

${dichoBlock}`
      : dichoBlock;
  // H3 — con su ruta, como el «Contents of …/CLAUDE.md» de Claude Code: son los
  // ficheros /memoria, y ya cuentan como leídos (`memoriaSembrada`).
  const memoriaBlock = userMemoryBlock(args.userMemory, RUTA_MEMORIA_DUENO);
  // ⚰️ AQUÍ IBA EL DOCUMENTO: la página activa con un `data-op-id` en cada
  // elemento, delante de todo; o, con un pin, sólo su sección más un índice del
  // resto; o, si no cabía, sólo el índice (el «plano B»), con `leer_estado
  // op_id=` para abrir secciones. Len 2.0 edita el sitio como ficheros
  // (plans/len-2/ficheros-plan.md, T8c): lo lee con Read —entero, por trozos o
  // buscando con Grep—, igual que Claude Code, que no recibe los ficheros
  // pegados al mensaje. Qué ficheros hay y cuál tiene abierto el dueño va en el
  // ESTADO (`ficheros`, `abierta_en_el_editor`).
  return `${recorteBlock}${memoriaBlock}${hoy}ESTADO DEL PROYECTO (real, leído del servidor ahora mismo):\n${JSON.stringify(args.state, null, 2)}\n\n${briefBlock}${seleccionBlock(args.seleccion)}${imageBlock}${changelogBlock(args.cambios ?? [])}${cambiosDelDuenoBlock(args.cambiosDelDueno ?? [])}`;
}


/** Rough chars→tokens estimate (~3.5 chars/token on tag-dense HTML + JSON),
 *  used as a pre-flight size guard before the route ships a turn upstream. */
export function estimateContextTokens(userContent: string, systemPrompt: string): number {
  return Math.ceil((userContent.length + systemPrompt.length) / 3.5);
}

export interface BuildAgentMessagesArgs {
  /** Los nombres de las herramientas DIFERIDAS (H2): van delante, en el
   *  `<system-reminder>` de Claude Code, para que el modelo sepa que existen y
   *  las cargue con ToolSearch. Ausente o vacía ⇒ ningún aviso. */
  diferidas?: readonly string[];
  /** summarizeProjectState(...) output — the caller computes it (it needs the
   *  DB row); this module stays free of @/lib/agent/tools' native imports. */
  state: Record<string, unknown>;
  /** Ver buildAgentContext.turnoAnteriorMudo. */
  turnoAnteriorMudo?: boolean;
  /** Ver avisosDelTurno.objetivo — la condición de parada activa del proyecto.
   *  Ausente/`null` ⇒ salida byte-idéntica. */
  objetivo?: { readonly condicion: string } | null;
  /** Ver buildAgentContext.userMemory. */
  userMemory?: string | null;
  /** Ver buildAgentContext.cambios. */
  cambios?: readonly CambioHecho[];
  /** Ver buildAgentContext.cambiosDelDueno. */
  cambiosDelDueno?: readonly string[];
  /** Ver buildAgentContext.dichoAntes. */
  dichoAntes?: readonly string[];
  /** Ver buildAgentContext.degradaciones. */
  degradaciones?: readonly DegradacionConocida[];
  /** Ver buildAgentContext.conversacionRecortada. */
  conversacionRecortada?: { visibles: number; totales: number } | null;
  userBrief: string | null;
  /** The user's turn prompt (already trimmed/validated by the caller). */
  prompt: string;
  /** Prior turns, ALREADY hardened to {role, content} + capped by the caller
   *  (the route slices to 36 + 4000 chars). */
  history: readonly MensajeDelHistorial[];
  attachedImage?: { url: string; alt?: string; visible?: boolean } | null;
  /** Ver buildAgentContext.seleccion. */
  seleccion?: SeleccionDelDueno | null;
  /** Pre-flight size ceiling; over it → { ok:false, reason:"too_large" }. */
  maxPromptTokens: number;
}

export type BuildAgentMessagesResult =
  | { ok: true; messages: Message[]; systemPrompt: string; contextBlock: string }
  | { ok: false; reason: "too_large" };

/** Marca dónde acaba el contexto que pone el servidor y empiezan las palabras
 *  literales del usuario. Sin ella, la petición se lee como una línea más del
 *  volcado de ESTADO DEL PROYECTO que la precede. */
export const PETICION_DEL_USUARIO = "LO QUE TE PIDE EL USUARIO AHORA:\n";

/** Assemble the exact message array an agent turn ships upstream: system
 *  prompt, the prior history, then ONE user message carrying the context block
 *  (state + brief + optional selection/image blocks) followed by the
 *  user's own words. Shared by app/api/agent/route.ts and the eval harness so a
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
 *  Y el contexto va PEGADO a la petición, al final del array, no colgando
 *  antes del historial: es el punto de generación, y es donde la tarea 4
 *  necesita poder colgar los avisos por turno. */
export function buildAgentMessages(args: BuildAgentMessagesArgs): BuildAgentMessagesResult {
  const systemPrompt = buildAgentSystemPrompt();
  const contextBlock = buildAgentContext({
    state: args.state,
    userBrief: args.userBrief,
    turnoAnteriorMudo: args.turnoAnteriorMudo,
    userMemory: args.userMemory,
    cambios: args.cambios,
    cambiosDelDueno: args.cambiosDelDueno,
    dichoAntes: args.dichoAntes,
    degradaciones: args.degradaciones,
    conversacionRecortada: args.conversacionRecortada,
    attachedImage: args.attachedImage,
    seleccion: args.seleccion,
  });
  const avisos = avisosDelTurno({
    turnoAnteriorMudo: args.turnoAnteriorMudo,
    degradaciones: args.degradaciones,
    objetivo: args.objetivo,
  });
  // H4: con los resultados enteros en el historial, el techo cuenta también las
  // llamadas y sus respuestas, no sólo el texto (ver `textoDelHistorial`).
  const historyText = textoDelHistorial(args.history);
  // Los avisos cuentan para el techo: son parte del turno, no un extra que
  // aparece después de haber decidido que cabía.
  if (estimateContextTokens(contextBlock + historyText + args.prompt + avisos, systemPrompt) > args.maxPromptTokens) {
    return { ok: false, reason: "too_large" };
  }
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    ...args.history,
    { role: "user", content: `${args.diferidas?.length ? `${avisoDeDiferidas(args.diferidas)}

` : ""}${contextBlock}${PETICION_DEL_USUARIO}${args.prompt}${avisos}` },
  ];
  return { ok: true, messages, systemPrompt, contextBlock };
}
