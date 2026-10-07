/**
 * LA TRANSCRIPCIÓN DEL TURNO — el historial como el de Claude Code (H4, parte 3;
 * plans/len-2/hipotesis/H4-alcance-prompt-e-historial.md).
 *
 * Hasta H4 el historial lo mandaba el NAVEGADOR, y el servidor, por no fiarse,
 * le quitaba los argumentos de cada llamada (el modelo veía «Edit {}») y dejaba
 * cada resultado en un resumen de 400 caracteres. Claude Code guarda su
 * transcripción del lado de confianza, entera, y cuando crece VACÍA los
 * resultados viejos con una marca (`RESULTADO_VACIADO`, su
 * «microcompact») en vez de resumirlos: la llamada se queda, el contenido se va.
 *
 * Aquí igual: el servidor escribe la transcripción de cada turno en
 * `projectChatMessages.transcript` y la reconstruye al empezar el siguiente.
 * Nada de lo que manda el navegador entra en ella.
 *
 * Y LO LEÍDO DURA LA CONVERSACIÓN, como lo leído en Claude Code: se
 * guarda la HUELLA de cada fichero leído, y al empezar el turno siguiente cuenta
 * como leído si no cambió y su resultado sigue a la vista.
 *
 * Decidido en voz alta: Claude Code conserva los N resultados más recientes.
 * Aquí se conserva por CARACTERES, porque
 * nuestros resultados varían cien veces de tamaño (una línea de Grep contra una
 * página entera): `PRESUPUESTO_DE_RESULTADOS`, desde el más reciente.
 *
 * Puro salvo la huella (`node:crypto`).
 */
import { createHash } from "node:crypto";

import type { InlineImage, Message } from "@/lib/ai-gateway";
import { CLAVE_TOOL_RESULT } from "@/lib/agent/ficheros/resultado";
import { normalizarFinales, type Leidos } from "@/lib/agent/ficheros/read";
import { CLAVE_CAMBIOS_DEL_COMANDO } from "@/lib/agent/terminal/cambios-del-comando";
import { currentToolCall, currentToolName } from "@/lib/agent/tool-renames";
import type { GoalSnapshot } from "@/lib/agent/goal";
import { photosOf, type ChatPhoto } from "@/lib/projects/chat-photos";

/** La misma marca que usa Claude Code. */
export const RESULTADO_VACIADO = "[Earlier tool result removed to save space]";

/** Caracteres de resultados que viajan ENTEROS, contando desde el más reciente
 *  (~20 K tokens). Lo que queda más atrás, vaciado. */
export const PRESUPUESTO_DE_RESULTADOS = 80_000;

/** Tope de una transcripción al guardarla. Un turno con muchas lecturas de
 *  páginas grandes no puede escribir megas en la fila: se vacían sus
 *  resultados más viejos hasta caber. */
export const TOPE_TRANSCRIPCION = 400_000;

/** Un mensaje del historial: el `Message` del bucle sin el papel de sistema.
 *  Lo cumplen también los del navegador (`MensajeSaneado`).
 *
 *  `opensTurn` (N39): éste es el mensaje del DUEÑO que abrió un turno. Lo marca
 *  la fila, que es el turno —como el `turn/start` del arnés de DeepSeek—, porque
 *  con papel de usuario viajan también cosas que no abren turno: la insistencia
 *  del servidor, lo medido al cerrar, la corrección a media faena. No llega al
 *  modelo: el puente arma cada mensaje campo a campo. */
export type MensajeDelHistorial = Omit<Message, "role"> & { role: "user" | "assistant"; opensTurn?: true };

/** Todo lo que el historial pone delante del modelo, como texto: el contenido,
 *  lo pensado (H15), los argumentos de cada llamada y cada respuesta tal y como
 *  viaja. Es lo que cuenta el techo de contexto. Lo pensado ocupa exactamente
 *  su longitud más un salto: quitarlo baja la cuenta en eso (`context.ts`). */
export function textoDelHistorial(historial: readonly MensajeDelHistorial[]): string {
  return historial
    .map((m) =>
      [
        m.content,
        ...(m.reasoning ? [m.reasoning] : []),
        ...(m.functionCalls ?? []).map((c) => JSON.stringify(c.args ?? {})),
        ...(m.functionResponses ?? []).map((r) => {
          const t = r.response[CLAVE_TOOL_RESULT];
          return typeof t === "string" ? t : JSON.stringify(r.response);
        }),
      ].join("\n"),
    )
    .join("\n");
}

/** Lo leído, guardado como huella: el contenido ya está en la página. */
export interface LecturaGuardada {
  readonly ruta: string;
  readonly huella: string;
  readonly offset?: number;
  readonly limit?: number;
  readonly vistaParcial?: true;
}

export interface TranscripcionGuardada {
  readonly mensajes: Message[];
  readonly leidos: LecturaGuardada[];
  /** PIEZA 7 · el turno cerró en modo plan: la foto de la que se pliega el
   *  estado al empezar el siguiente (`planModeFromRows`). Ausente = no. */
  readonly planMode?: true;
  /** PIEZA 8 · el encargo como quedó al cerrar el turno (`goalFromRows` lo
   *  pliega). Ausente = no había; `null` = se quitó. */
  readonly goal?: GoalSnapshot | null;
  /** El dueño paró el turno con ■ antes de que terminara (el `interrupted` de
   *  DeepSeek). El historial lo dice con `MARCA_DE_TURNO_DETENIDO`. */
  readonly detenido?: true;
}

/**
 * LO QUE EL MODELO LEE DETRÁS DE UN TURNO QUE EL DUEÑO PARÓ, como el
 * «[Request interrupted by user]» de Claude Code. Sin ella, un «La escribo
 * entera.» cortado a mitad del Write se leía como una promesa pendiente, y el
 * turno siguiente la cumplía aunque el dueño hubiera pasado a otra cosa
 * (ensayo de caja de crear-es-len, 06/10). Sólo el hecho: qué hacer con él lo
 * decide el modelo con lo que diga el dueño después.
 */
export const MARCA_DE_TURNO_DETENIDO =
  "[Request interrupted by the owner (■): this turn did not finish, and only what is above got done.]";

/** Una fila de `projectChatMessages`, con lo que hace falta para el historial. */
export interface FilaDelHistorial {
  readonly userText: string;
  readonly assistantReasoning: string;
  readonly transcript: TranscripcionGuardada | null;
  /** Las fotos que el dueño adjuntó a ese turno (columna `attachedImage`):
   *  un objeto en las filas de siempre, una lista con dos o más (`photosOf`). */
  readonly attachedImage?: ChatPhoto | readonly ChatPhoto[] | null;
}

/**
 * LOTE 7-8 · LA FOTO DE UN TURNO QUE CAYÓ SIN TRANSCRIPCIÓN. El pliegue
 * (`planModeFromRows`, `goalFromRows`) toma la última fila CON transcripción, y
 * un turno que revienta no la tiene: un `enter_plan_mode` aceptado o un
 * `create_goal` justo antes de caer se perdían al recargar. En DeepSeek ese
 * cambio es un evento duradero de la sesión en el momento (`goal/change`, el
 * modo plan); aquí, si el estado cambió en el turno, la fila lleva una
 * transcripción VACÍA con la foto —el historial cae a `assistantReasoning` y no
 * siembra lecturas—; si no cambió, `null`, como siempre.
 */
export function stateOnlyTranscript(o: {
  readonly folded: { readonly planMode: boolean; readonly goal: GoalSnapshot | null };
  readonly now: { readonly planMode: boolean; readonly goal: GoalSnapshot | null };
}): TranscripcionGuardada | null {
  if (o.now.planMode === o.folded.planMode && o.now.goal === o.folded.goal) return null;
  return {
    mensajes: [],
    leidos: [],
    ...(o.now.planMode ? { planMode: true as const } : {}),
    ...(o.now.goal ? { goal: o.now.goal } : {}),
  };
}

const huella = (texto: string) => createHash("sha1").update(normalizarFinales(texto)).digest("hex");

/** El tamaño de una respuesta tal y como viaja al modelo (ver `fireworks-bridge`). */
function tamanoDeRespuesta(response: Record<string, unknown>): number {
  const texto = response[CLAVE_TOOL_RESULT];
  return typeof texto === "string" ? texto.length : JSON.stringify(response).length;
}

function vaciada(response: Record<string, unknown>): Record<string, unknown> {
  return { ...(typeof response.ok === "boolean" ? { ok: response.ok } : {}), [CLAVE_TOOL_RESULT]: RESULTADO_VACIADO };
}

/** Sólo estos campos de `Message`: nada más se guarda ni se reenvía. Lo pensado
 *  por Len (H15 fase 2, 02/10) se guarda con su mensaje y vuelve en los turnos
 *  siguientes, como en el arnés de DeepSeek; las fotos no (las pone la ruta). */
function limpio<M extends Message | MensajeDelHistorial>(m: M): M {
  return {
    role: m.role,
    content: typeof m.content === "string" ? m.content : "",
    ...(m.role === "assistant" && typeof m.reasoning === "string" && m.reasoning ? { reasoning: m.reasoning } : {}),
    // Con el nombre de HOY (pieza 3: `preguntar` → `ask_user_question`): el
    // modelo no puede leer una llamada a una herramienta que ya no tiene.
    ...(m.functionCalls?.length ? { functionCalls: m.functionCalls.map(currentToolCall) } : {}),
    ...(m.functionResponses?.length
      ? { functionResponses: m.functionResponses.map((r) => ({ name: currentToolName(r.name), response: r.response ?? {} })) }
      : {}),
  } as M;
}

/**
 * EL MICROCOMPACT. Recorre las respuestas de la más reciente a la más vieja y
 * deja enteras las que caben en `presupuesto`; a partir de la primera que no
 * cabe, todas las anteriores se vacían (la llamada se queda).
 */
function microcompactar<M extends Message | MensajeDelHistorial>(mensajes: M[], presupuesto: number): M[] {
  let usado = 0;
  let agotado = false;
  const salida = [...mensajes];
  for (let i = salida.length - 1; i >= 0; i--) {
    const m = salida[i]!;
    if (!m.functionResponses?.length) continue;
    const respuestas = [...m.functionResponses].reverse().map((r) => {
      if (r.response[CLAVE_TOOL_RESULT] === RESULTADO_VACIADO) return r;
      const t = tamanoDeRespuesta(r.response);
      if (agotado || usado + t > presupuesto) {
        agotado = true;
        return { name: r.name, response: vaciada(r.response) };
      }
      usado += t;
      return r;
    });
    salida[i] = { ...m, functionResponses: respuestas.reverse() };
  }
  return salida;
}

/** La transcripción del turno lista para la fila: limpia, con la huella de lo
 *  leído y dentro de su tope. */
export function transcripcionParaGuardar(mensajes: readonly Message[], leidos: Leidos): TranscripcionGuardada {
  const lecturas: LecturaGuardada[] = [...leidos].map(([ruta, l]) => ({
    ruta,
    huella: huella(l.instantanea),
    ...(l.offset !== undefined ? { offset: l.offset } : {}),
    ...(l.limit !== undefined ? { limit: l.limit } : {}),
    ...(l.vistaParcial ? { vistaParcial: true as const } : {}),
  }));
  let limpios = mensajes.map(limpio);
  // Lo que sólo es para la pantalla se va ANTES que nada de lo que lee el
  // modelo: que la lente pierda un diff, no que Len pierda un resultado.
  if (JSON.stringify(limpios).length > TOPE_TRANSCRIPCION) limpios = sinLoDeLaPantalla(limpios);
  if (JSON.stringify(limpios).length > TOPE_TRANSCRIPCION) limpios = microcompactar(limpios, TOPE_TRANSCRIPCION / 2);
  return { mensajes: limpios, leidos: lecturas };
}

/** Las respuestas sin lo que el modelo no lee: los cambios de cada `bash` (la #10). */
function sinLoDeLaPantalla<M extends Message>(mensajes: M[]): M[] {
  return mensajes.map((m) =>
    m.functionResponses?.some((r) => CLAVE_CAMBIOS_DEL_COMANDO in r.response)
      ? {
          ...m,
          functionResponses: m.functionResponses.map((r) => {
            if (!(CLAVE_CAMBIOS_DEL_COMANDO in r.response)) return r;
            const resto = { ...r.response };
            delete resto[CLAVE_CAMBIOS_DEL_COMANDO];
            return { name: r.name, response: resto };
          }),
        }
      : m,
  );
}

/** Una foto que se consiguió pero NO cabe en esta petición con las más nuevas
 *  (`fotosQueCaben`): va sin píxeles, con su dirección. */
export const NO_CABE = "no-cabe";

/** Las fotos de la conversación, por dirección: sus píxeles; `null` si no se
 *  pudieron descargar; `NO_CABE` si no caben con las más nuevas. */
export type FotosDeLaConversacion = ReadonlyMap<string, InlineImage | null | typeof NO_CABE>;

/** La nota que va con la foto en tu mensaje: dónde vive, para que Len la pueda
 *  poner con su dirección exacta en cualquier turno. Es lo que hace Claude Code
 *  al pegar una imagen (anota dónde la guardó), con palabras nuestras. Sin la
 *  foto a la vista, la nota dice por qué —como el texto que deja DeepSeek
 *  cuando quita una imagen para caber—, y la dirección se queda: Len la puede
 *  seguir poniendo sin que se la vuelvan a mandar. */
export function notaDeLaFoto(foto: { url: string; alt?: string }, estado: "vista" | "no-cargo" | typeof NO_CABE): string {
  const alt = foto.alt ? ` — «${foto.alt}»` : "";
  const porque =
    estado === "vista"
      ? ""
      : estado === NO_CABE
        ? " (not in view: it didn't fit with the others; the address works just the same)"
        : " (it couldn't be loaded to see it)";
  return `[Attached photo: ${foto.url}${alt}${porque}]`;
}

/** Tu mensaje de un turno pasado: el texto y, si mandaste fotos, una nota por
 *  foto y los píxeles de las que se consiguieron. Sin foto, el mensaje de
 *  siempre, byte a byte; con una, el de siempre también. */
function mensajeDelDueno(f: FilaDelHistorial, fotos: FotosDeLaConversacion): MensajeDelHistorial {
  const adjuntas = photosOf(f.attachedImage);
  if (adjuntas.length === 0) return { role: "user", content: f.userText, opensTurn: true };
  const notas: string[] = [];
  const imagenes: InlineImage[] = [];
  for (const adjunta of adjuntas) {
    const foto = fotos.get(adjunta.url) ?? null;
    const estado = foto === NO_CABE ? NO_CABE : foto ? "vista" : "no-cargo";
    notas.push(notaDeLaFoto(adjunta, estado));
    if (foto && foto !== NO_CABE) imagenes.push(foto);
  }
  return {
    role: "user",
    opensTurn: true,
    content: `${f.userText}\n\n${notas.join("\n")}`,
    ...(imagenes.length > 0 ? { images: imagenes } : {}),
  };
}

/** El historial de la conversación desde las filas (de la más vieja a la más
 *  reciente), con el microcompact aplicado. La foto de cada turno va pegada a
 *  tu mensaje, como una imagen pegada en Claude Code: sigue en la conversación
 *  mientras ese turno esté en lo que Len ve. Los píxeles los consigue la ruta
 *  (`fotos`); aquí no se descarga nada. */
export function historialDesdeLaBase(
  filas: readonly FilaDelHistorial[],
  presupuesto: number = PRESUPUESTO_DE_RESULTADOS,
  fotos: FotosDeLaConversacion = new Map(),
): MensajeDelHistorial[] {
  const mensajes: MensajeDelHistorial[] = [];
  for (const f of filas) {
    mensajes.push(mensajeDelDueno(f, fotos));
    if (f.transcript?.mensajes.length) {
      // Del bucle sólo salen mensajes de usuario y de asistente; uno de sistema
      // no tiene sitio en un historial y no se reenvía.
      for (const m of f.transcript.mensajes) if (m.role !== "system") mensajes.push(limpio({ ...m, role: m.role }));
    } else if (f.assistantReasoning.trim()) {
      mensajes.push({ role: "assistant", content: f.assistantReasoning });
    }
    if (f.transcript?.detenido) mensajes.push({ role: "user", content: MARCA_DE_TURNO_DETENIDO });
  }
  return microcompactar(mensajes, presupuesto);
}

/** Las rutas cuya última lectura o escritura sigue ENTERA en el historial. */
function rutasALaVista(historial: readonly MensajeDelHistorial[]): Set<string> {
  const vistas = new Set<string>();
  const vaciadas = new Set<string>();
  for (let i = historial.length - 1; i >= 0; i--) {
    const m = historial[i]!;
    if (!m.functionResponses?.length) continue;
    const llamadas = historial[i - 1]?.functionCalls ?? [];
    m.functionResponses.forEach((r, j) => {
      const ruta = llamadas[j]?.args?.file_path;
      if (typeof ruta !== "string" || vistas.has(ruta) || vaciadas.has(ruta)) return;
      if (r.response[CLAVE_TOOL_RESULT] === RESULTADO_VACIADO) vaciadas.add(ruta);
      else vistas.add(ruta);
    });
  }
  return vistas;
}

/**
 * Lo que cuenta como leído al empezar el turno: lo que el turno anterior dejó
 * leído, si el fichero NO cambió desde entonces (su huella) y su resultado sigue
 * a la vista en el historial. Si cambió, hay que releerlo —como en Claude Code,
 * que compara con el disco antes de dejar editar—.
 */
export function leidosSembrados(
  guardados: readonly LecturaGuardada[],
  historial: readonly MensajeDelHistorial[],
  contenido: (ruta: string) => string | null,
): Leidos {
  const aLaVista = rutasALaVista(historial);
  const leidos: Leidos = new Map();
  for (const g of guardados) {
    if (!aLaVista.has(g.ruta)) continue;
    const actual = contenido(g.ruta);
    if (actual === null || huella(actual) !== g.huella) continue;
    leidos.set(g.ruta, {
      instantanea: normalizarFinales(actual),
      offset: g.offset,
      limit: g.limit,
      ...(g.vistaParcial ? { vistaParcial: true as const } : {}),
    });
  }
  return leidos;
}
