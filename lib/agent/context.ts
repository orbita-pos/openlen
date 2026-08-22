// lib/agent/context.ts — builds the per-turn context block the agent route
// injects as the first user message (state + brief + tagged document), plus
// buildAgentMessages, the single message-assembly path both the route AND the
// eval harness (F3 Task 6) consume so a turn is byte-identical either way.
//
// Pure string building, zero I/O, zero native imports — the caller feeds it
// server-read state (summarizeProjectState) and the already-tagged HTML
// (tagWithOpIds); this module just formats. Keeping it import-free of
// @/lib/html-engine (native) and @/lib/db lets context.test.ts run under
// vitest without the native bindings being loadable. buildAgentSystemPrompt
// (from catalog) is pure TS too — no native — so importing it here keeps that
// invariant.

import { todayLine } from "@/lib/ai/today-line";
import type { Message } from "@/lib/ai-gateway";
import { buildAgentSystemPrompt } from "@/lib/agent/catalog";
// Sin importaciones nativas ni de @/lib/db: model-runtime sólo usa node:vm y
// node-html-parser, así que el invariante de arriba se mantiene.
import { currentRuntimePromptBlock } from "@/lib/ai-stream/model-runtime";

/**
 * El bloque para el prompt, o `""` cuando no hay nada.
 *
 * `""` importa: sin memoria, el contexto sale BYTE A BYTE como antes de que
 * esto existiera — ningún proyecto paga tokens por una capacidad que no usa,
 * y la caché de prefijo no se invalida para quien nunca guardó nada.
 */
export function userMemoryBlock(memoria: string | null | undefined): string {
  const v = memoria?.trim();
  if (!v) return "";
  return `LO QUE SABES DE ESTA PERSONA (de conversaciones anteriores, en CUALQUIERA de sus páginas — no es de este proyecto, es de ella):
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

export function buildAgentContext(args: {
  /** Inyectable sólo para las pruebas: sin esto el bloque HOY cambiaría cada
   *  día y ninguna prueba podría fijarlo. */
  now?: Date;
  state: Record<string, unknown>;
  taggedHtml: string;
  /** El JavaScript que la página YA tiene, verificado contra su cápsula.
   *  `taggedHtml` viene SANEADO —sin scripts—, así que sin esto el Agente no ve
   *  la conducta que el usuario le pide arreglar y la re-inventa.
   *  Ausente/vacío ⇒ salida byte-idéntica. */
  runtime?: string | null;
  /** Los ítems del catálogo, que NO están en el documento (se hornean al
   *  publicar). Ausente/vacío ⇒ salida byte-idéntica. */
  catalogo?: string;
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
  /** Cuántos turnos de la conversación ve, de cuántos hay. Ausente o iguales ⇒
   *  no se dice nada. */
  conversacionRecortada?: { visibles: number; totales: number } | null;
  userBrief: string | null;
  /** F2 Task 8 — the user attached an image this turn (same shape the route
   *  validates in ai-design: real http(s) URL, optional alt). Present ⇒ the
   *  model is told to place it via editar_pagina using the URL verbatim,
   *  replacing a placeholder if one exists. Absent/omitted ⇒ output is
   *  byte-identical to F1 (pinned by context.test.ts).
   *  F5 — `visible: true` means the route ALSO attached the image's pixels to
   *  the first model turn (inlineData), so the block tells the model it can
   *  actually SEE the image, not just its URL. */
  attachedImage?: { url: string; alt?: string; visible?: boolean } | null;
  /** F2 Task 8 — a hard-pinned target op-id (scope.path resolved against the
   *  tagged document by the route via resolveOpIdByPath), same semantics as
   *  ai-design's scopePin. Takes priority over scopeHint when both are set. */
  scopePin?: { opId: string; hint: string } | null;
  /** F2 Task 8 — a soft textual scope hint (scope.hint with no resolvable
   *  path). Ignored when scopePin is set. */
  scopeHint?: string | null;
  /** F4 Task 1 — the slug of the page this turn is active on (route-validated
   *  against data.pages), or null/omitted for the home document. Non-null ⇒
   *  the ESTADO block gains a `pagina_activa` field and the DOCUMENTO header
   *  names the page. null/omitted ⇒ output is byte-identical to F3 (pinned in
   *  context.test.ts) — most turns today are still home-only. */
  activePage?: string | null;
}): string {
  const brief = (args.userBrief ?? "").trim();
  const briefBlock = brief
    ? `PROJECT BRIEF (persistente — aplica a toda petición):\n${brief}\n\n`
    : "";

  let focusBlock = "";
  if (args.scopePin) {
    focusBlock = `FOCO DEL USUARIO (PIN): target="${args.scopePin.opId}" — el usuario señaló este elemento EXACTO (${args.scopePin.hint}). Ancla tu edit principal de editar_pagina en este data-op-id. Solo amplía a hermanos/ancestros cuando la petición del usuario lo implique explícitamente.\n\n`;
  } else if (args.scopeHint) {
    focusBlock = `PISTA DE FOCO DEL USUARIO: el usuario señaló hacia → ${args.scopeHint}. Centra tus cambios ahí si es relevante. Puedes tocar elementos hermanos o relacionados cuando la petición lo implique.\n\n`;
  }

  let imageBlock = "";
  if (args.attachedImage) {
    const altLine = args.attachedImage.alt ? `\nTexto alt: ${args.attachedImage.alt}` : "";
    // F5: cuando los píxeles viajan adjuntos al turno, díselo — puede diseñar
    // CON la imagen (colores, orientación, contenido) en vez de colocarla a
    // ciegas. Sin visible, el texto queda byte-idéntico a F2 (pinned).
    const seeLine = args.attachedImage.visible
      ? `\nLa imagen viene ADJUNTA a este turno y PUEDES VERLA: úsala para decidir dónde y cómo colocarla — combina la paleta y el layout con sus colores, orientación y contenido, y escribe un alt fiel a lo que muestra.`
      : "";
    imageBlock = `IMAGEN ADJUNTA DEL USUARIO: ${args.attachedImage.url}${altLine}${seeLine}\nEsta es una URL de imagen REAL que el usuario adjuntó explícitamente — colócala con editar_pagina usando esta URL EXACTA (verbatim) como src de un <img> (o como CSS background-image). NUNCA inventes ni cambies la URL. Si la página ya tiene un placeholder para esta imagen (un <div> con gradiente, una caja vacía con borde), REEMPLAZA ese elemento completo por el <img> — no lo anides adentro. Incluye siempre texto alt (usa el del usuario si lo dio; si no, infiérelo del contexto).\n\n`;
  }

  // Non-null activePage merges into the ESTADO JSON (never mutates args.state)
  // and renames the DOCUMENTO header. When it's null/omitted, stateForPrompt
  // is the same reference as args.state and docHeader is the F3 literal — the
  // whole return is byte-identical to F3 (pinned in context.test.ts).
  const stateForPrompt = args.activePage
    ? { ...args.state, pagina_activa: args.activePage }
    : args.state;
  const docHeader = args.activePage
    ? `DOCUMENTO ACTUAL — página "${args.activePage}" (cada elemento trae data-op-id inyectado por el servidor — usa esos ids en editar_pagina):`
    : `DOCUMENTO ACTUAL (cada elemento trae data-op-id inyectado por el servidor — usa esos ids en editar_pagina):`;

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
  const recorteBlock =
    rec && rec.totales > rec.visibles
      ? `NOTA SOBRE LA CONVERSACIÓN: ves los últimos ${rec.visibles} turnos, pero esta charla lleva ${rec.totales}. Si te preguntan por algo anterior a lo que ves, DILO («de eso ya no me acuerdo») en vez de contestar con el turno más viejo que tengas a mano — eso es equivocarse con seguridad, que es la peor forma. Lo que sí sobrevive entero es el registro de cambios de más abajo.

`
      : "";
  const memoriaBlock = userMemoryBlock(args.userMemory);
  // Hecho, no juicio: no se mira lo que el modelo DIJO, sino si llamó a alguna
  // herramienta. Va arriba del todo porque corrige una creencia suya sobre el
  // pasado inmediato.
  const mudoBlock = args.turnoAnteriorMudo
    ? `AVISO: tu turno anterior NO llamó a ninguna herramienta, así que la página NO cambió — hagas lo que hagas ahora, no des por hecho lo que dijiste que habías hecho. Si el usuario te pidió un cambio y sigue sin aplicarse, aplícalo AHORA con editar_pagina.

`
    : "";
  return `${mudoBlock}${recorteBlock}${memoriaBlock}${hoy}ESTADO DEL PROYECTO (real, leído del servidor ahora mismo):\n${JSON.stringify(stateForPrompt, null, 2)}\n\n${briefBlock}${focusBlock}${imageBlock}${docHeader}\n\n${args.taggedHtml}${args.catalogo ?? ""}${changelogBlock(args.cambios ?? [])}${currentRuntimePromptBlock(args.runtime ?? "", "tool")}`;
}

/** Rough chars→tokens estimate (~3.5 chars/token on tag-dense HTML + JSON),
 *  used as a pre-flight size guard before the route ships a turn upstream. */
export function estimateContextTokens(userContent: string, systemPrompt: string): number {
  return Math.ceil((userContent.length + systemPrompt.length) / 3.5);
}

export interface BuildAgentMessagesArgs {
  /** summarizeProjectState(...) output — the caller computes it (it needs the
   *  DB row); this module stays free of @/lib/agent/tools' native imports. */
  state: Record<string, unknown>;
  /** tagWithOpIds(html).taggedHtml — computed by the caller (native). */
  taggedHtml: string;
  /** Ver buildAgentContext.catalogo. */
  catalogo?: string;
  /** Ver buildAgentContext.runtime. */
  runtime?: string | null;
  /** Ver buildAgentContext.turnoAnteriorMudo. */
  turnoAnteriorMudo?: boolean;
  /** Ver buildAgentContext.userMemory. */
  userMemory?: string | null;
  /** Ver buildAgentContext.cambios. */
  cambios?: readonly CambioHecho[];
  /** Ver buildAgentContext.conversacionRecortada. */
  conversacionRecortada?: { visibles: number; totales: number } | null;
  userBrief: string | null;
  /** The user's turn prompt (already trimmed/validated by the caller). */
  prompt: string;
  /** Prior turns, ALREADY hardened to {role, content} + capped by the caller
   *  (the route slices to 6 + 4000 chars; the harness passes []). */
  history: { role: "user" | "assistant"; content: string }[];
  attachedImage?: { url: string; alt?: string } | null;
  scopePin?: { opId: string; hint: string } | null;
  scopeHint?: string | null;
  /** F4 Task 1 — threaded straight to buildAgentContext's activePage. See its
   *  doc: non-null names the page in ESTADO/DOCUMENTO; null/omitted keeps the
   *  turn byte-identical to F3. */
  activePage?: string | null;
  /** Pre-flight size ceiling; over it → { ok:false, reason:"too_large" }. */
  maxPromptTokens: number;
}

export type BuildAgentMessagesResult =
  | { ok: true; messages: Message[]; systemPrompt: string; contextBlock: string }
  | { ok: false; reason: "too_large" };

/** Assemble the exact message array an agent turn ships upstream: system
 *  prompt, the context block (state + brief + tagged doc + optional image/scope
 *  blocks), a fixed synthetic assistant ack, the prior history, then the user
 *  prompt. Shared by app/api/agent/route.ts and the eval harness so a turn is
 *  byte-identical whichever entry point built it. Applies the same pre-flight
 *  size guard the route used inline (413 on overflow). */
export function buildAgentMessages(args: BuildAgentMessagesArgs): BuildAgentMessagesResult {
  const systemPrompt = buildAgentSystemPrompt();
  const contextBlock = buildAgentContext({
    state: args.state,
    taggedHtml: args.taggedHtml,
    runtime: args.runtime,
    catalogo: args.catalogo,
    userBrief: args.userBrief,
    turnoAnteriorMudo: args.turnoAnteriorMudo,
    userMemory: args.userMemory,
    cambios: args.cambios,
    conversacionRecortada: args.conversacionRecortada,
    attachedImage: args.attachedImage,
    scopePin: args.scopePin,
    scopeHint: args.scopeHint,
    activePage: args.activePage,
  });
  const historyText = args.history.map((h) => h.content).join("\n");
  if (estimateContextTokens(contextBlock + historyText + args.prompt, systemPrompt) > args.maxPromptTokens) {
    return { ok: false, reason: "too_large" };
  }
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: contextBlock },
    { role: "assistant", content: "Entendido. Tengo el estado y el documento. ¿Qué hacemos?" },
    ...args.history,
    { role: "user", content: args.prompt },
  ];
  return { ok: true, messages, systemPrompt, contextBlock };
}
