// El hilo del chat de la app: la conversación guardada de esa página (la MISMA
// que el Chat de la web), lo que pasa en esta sesión (lo que mandas, tus
// notas, la llamada) y el turno que corre ahora. Puro: la pantalla sólo pinta.
// Sin pasos ni herramientas: el chat del móvil no es el de la web.
import { archivosDelHistorial, type ArchivoAdjunto } from "./archivos";
import { isLenMessageOrigin, isSubagentOrigin, type StoredChatTurn } from "@/lib/projects/types";
import { subagentRefFrom, type SubagentRef } from "@/lib/agent/subagents/card";
import { subagentRefsOf } from "./subagentes";
import { tarjetaDeConfirmacion, type TarjetaDeLlamada } from "@/components/llamada/puente-a-len";
import { currentToolName } from "@/lib/agent/tool-renames";
import { ASK_USER_QUESTION } from "@/lib/agent/ask-user-question";
import type { EventoSse } from "@/lib/len-bench/sse";
import { deliveredFrom, type DeliveredFile } from "@/lib/agent/skills/present";
import { SHOW_WIDGET, widgetFrom } from "@/lib/agent/visuals/widget";
import { lenRequestRefFrom, type LenRequestRef } from "@/lib/assistants/len-request-ref";
import { mcpApprovalFrom } from "@/lib/mcp-connectors/approval-card";
import { splitReplyAtWidgets, type ReplyWidget } from "@/lib/visuals/split-reply";
import { widgetIdOf } from "@/lib/visuals/widget-id";
import { createWidgetOffsets } from "@/lib/visuals/widget-offsets";

export type EstadoLocal = "ok" | "enviando" | "noSeEnvio" | "noSeSubio" | "transcribiendo" | "noSeEntendio";

/** En qué turno quedó lo que mandaste: el que empezó (su fila de la
 *  conversación) o, si Len ya trabajaba, el que corrigió. Lo que no ha salido
 *  no tiene. */
interface Enviado {
  fila?: string;
  correccion?: boolean;
}

export type ElementoDelHilo =
  | ({ clave: string; t: number; tipo: "tu"; texto: string; foto?: string; archivos?: readonly Pick<ArchivoAdjunto,"name"|"size"|"kind">[]; estado: EstadoLocal; goal?: "create" | "resume" } & Enviado)
  | ({ clave: string; t: number; tipo: "voz"; url: string; barras: number[]; segundos: number; transcripcion: string | null; estado: EstadoLocal } & Enviado)
  | { clave: string; t: number; tipo: "len"; texto: string }
  | { clave: string; t: number; tipo: "subagentes"; fila: string; refs: readonly SubagentRef[] }
  // Her requests to Len (spec local 2026-11-16-movil-es-tu-asistente, §5.4): one card per row of his, in her chat.
  | { clave: string; t: number; tipo: "lenPedidos"; refs: readonly LenRequestRef[] }
  | { clave: string; t: number; tipo: "origen"; origen: "subagentes" }
  // Len's message to this agent (spec local 2026-11-21-len-y-el-agente-conversan): the label of the turn it woke, naming the page they talk about.
  | { clave: string; t: number; tipo: "origen"; origen: "len"; proyecto: string }
  | { clave: string; t: number; tipo: "verEnTuPagina" }
  | { clave: string; t: number; tipo: "fallo" }
  | { clave: string; t: number; tipo: "tarjeta"; tarjeta: TarjetaDeLlamada }
  | { clave: string; t: number; tipo: "llamada"; segundos: number }
  | { clave: string; t: number; tipo: "aviso"; aviso: "sinMicro" | "tope" }
  | { clave: string; t: number; tipo: "dia"; dia: string }
  // Lo que Len entregó con `present` (spec local 2026-10-31-len-movil, §5.1): se abre en el visor.
  | { clave: string; t: number; tipo: "entregado"; archivos: readonly DeliveredFile[] }
  // Inline visuals (spec local 2026-11-22-visuales-de-verdad, §1): `clave = "visual:" + widgetId`, same live and stored.
  | { clave: string; t: number; tipo: "visual"; widgetId: string; widget: ReplyWidget; final: boolean };

export interface TurnoEnVivo {
  acciones?: NonNullable<StoredChatTurn["actions"]>;
  /** La fila de la conversación: el id que la app le da al turno al mandarlo. */
  fila: string | null;
  /** El del servidor, para corregirle el rumbo (`dirigir`): no es el de la fila. */
  turnoId: string | null;
  texto: string;
  /** The visual being written right now (`widget_preview`), anchored to its raw text offset. */
  liveWidget?: { title: string | null; loadingMessages: readonly string[]; code: string; textOffset: number };
  /** Tracks raw text offsets for incoming `widget_preview` and `show_widget` cards in this live turn. */
  widgetOffsets?: ReturnType<typeof createWidgetOffsets>;
  /** La herramienta que corre (o la última que corrió): la línea bajo su nombre. */
  avance: string | null;
  pregunta: boolean;
  tarjetas: TarjetaDeLlamada[];
  cambioLaPagina: boolean;
  error: boolean;
  terminado: boolean;
}

/** Lo que dijo Len, una burbuja por párrafo; las marcas de markdown fuera
 *  (en una burbuja se leen como asteriscos sueltos). A separator line («---», «***», «___», «- - -») goes too: alone it
 *  was a bubble that looked like someone typing, and the gap between bubbles already separates. It goes first, before
 *  «**» is stripped and «***» would be left as a lone «*». */
export function parrafos(texto: string): string[] {
  return texto
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*(?:\r?\n|$)/gm, "")
    // «__» only as bold (two, not touching a third): a fill-in blank («She ____ (work)…», a language teacher's exercise)
    // is a run of underscores and stays.
    .replace(/\*\*|(?<!_)__(?!_)|`/g, "")
    .replace(/^#+\s*/gm, "")
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n"),
    )
    .filter(Boolean);
}

/** What her `ask_len` calls passed to Len in a turn, one per row of his. */
export function lenRequestRefsOf(actions: StoredChatTurn["actions"] | undefined): LenRequestRef[] {
  const seen = new Set<string>();
  return (actions ?? []).flatMap((a) => {
    const ref = a.tool === "ask_len" ? lenRequestRefFrom(a.lenRequest) : null;
    if (!ref || seen.has(ref.filaId)) return [];
    seen.add(ref.filaId);
    return [ref];
  });
}

/** What `present` delivered in a turn's cards, only where its route serves it (`deliveredFrom`). */
function deliveredOf(actions: StoredChatTurn["actions"] | undefined): DeliveredFile[] {
  return (actions ?? []).filter((a) => a.tool === "present").flatMap((a) => deliveredFrom(a.delivered) ?? []);
}

/** Splits a reply's RAW text at its `show_widget` offsets BEFORE running `parrafos()` on each text slice:
 *  `parrafos()` strips markdown so offsets only match the raw string. Visual keys are `visual:<widgetId>` both live
 *  and stored so the iframe is never remounted at the hand-off. */
function elementosDeRespuesta(
  filaId: string,
  texto: string,
  acciones: StoredChatTurn["actions"] | undefined,
  liveWidget: TurnoEnVivo["liveWidget"],
  t: number,
  prefijoLen: string,
): ElementoDelHilo[] {
  const stored = (acciones ?? []).filter((a) => a.tool === SHOW_WIDGET && a.widget);
  const widgets: { key: string; offset: number | undefined; widget: ReplyWidget; live: boolean }[] = stored.map((a, k) => ({
    key: widgetIdOf(filaId, k),
    offset: a.textOffset,
    widget: a.widget!,
    live: false,
  }));
  if (liveWidget) {
    widgets.push({
      key: widgetIdOf(filaId, stored.length),
      offset: liveWidget.textOffset,
      widget: { title: liveWidget.title, loadingMessages: liveWidget.loadingMessages, code: liveWidget.code },
      live: true,
    });
  }
  const out: ElementoDelHilo[] = [];
  let nParrafo = 0;
  for (const part of splitReplyAtWidgets(texto, widgets)) {
    if (part.kind === "text") {
      for (const p of parrafos(part.text)) {
        out.push({ clave: `${prefijoLen}:${nParrafo++}`, t, tipo: "len", texto: p });
      }
    } else {
      out.push({
        clave: `visual:${part.key}`,
        t,
        tipo: "visual",
        widgetId: part.key,
        widget: part.widget,
        final: !part.live,
      });
    }
  }
  return out;
}

export function hiloDesdeElHistorial(turnos: StoredChatTurn[], ahora: number): ElementoDelHilo[] {
  const salida: ElementoDelHilo[] = [];
  for (const turno of turnos) {
    if (turno.tipo === "persona") continue;
    const t = turno.appliedAt ?? ahora;
    const archivos = archivosDelHistorial((turno as StoredChatTurn & {attachedFiles?:unknown}).attachedFiles);
    // Len's message to this agent: the row's text is HIS words, so the label comes first — also while the agent's turn runs.
    if (turno.origen && isLenMessageOrigin(turno.origen)) salida.push({ clave: `${turno.id}:origen`, t, tipo: "origen", origen: "len", proyecto: turno.origen.projectTitle });
    if (turno.userText.trim() || turno.attachedImage || archivos.length) {
      salida.push({ clave: `${turno.id}:tu`, t, tipo: "tu", texto: turno.userText.trim(), foto: turno.attachedImage?.url, ...(archivos.length ? {archivos} : {}), estado: "ok" });
    }
    // En curso: lo que lleva dicho lo pinta el turno en vivo (o el reenganche).
    if (turno.enCurso) continue;
    if (turno.origen && isSubagentOrigin(turno.origen)) salida.push({ clave: `${turno.id}:origen`, t, tipo: "origen", origen: "subagentes" });
    salida.push(...elementosDeRespuesta(turno.id, turno.assistantReasoning, turno.actions, undefined, t, `${turno.id}:len`));
    const refs = subagentRefsOf(turno.actions);
    if (refs.length) salida.push({ clave: `${turno.id}:subagentes`, t, tipo: "subagentes", fila: turno.id, refs });
    const pedidos = lenRequestRefsOf(turno.actions);
    if (pedidos.length) salida.push({ clave: `${turno.id}:lenPedidos`, t, tipo: "lenPedidos", refs: pedidos });
    const entregado = deliveredOf(turno.actions);
    if (entregado.length) salida.push({ clave: `${turno.id}:entregado`, t, tipo: "entregado", archivos: entregado });
    if (turno.status === "error") salida.push({ clave: `${turno.id}:fallo`, t, tipo: "fallo" });
    else if (turno.status === "applied" && !turno.noDocChange) salida.push({ clave: `${turno.id}:ver`, t, tipo: "verEnTuPagina" });
  }
  return salida;
}

/** Len cerró su último turno preguntándote algo y aún no le contestas. */
export function terminaEnPregunta(turnos: StoredChatTurn[]): boolean {
  const u = [...turnos].reverse().find(t => t.tipo !== "persona");
  return !!u && !u.enCurso && pendingQuestionOf(u) !== null;
}

type Accion = NonNullable<StoredChatTurn["actions"]>[number];
/** The question a closed turn of Len's ended on, still unanswered (its card: `preguntas`, or the old `pregunta`
 *  text) — or null. On the phone the answer is the next message to Len (it opens his next turn). */
export function pendingQuestionOf(turn: StoredChatTurn): Accion | null {
  if (turn.enCurso) return null;
  return (turn.actions ?? []).findLast((a) => currentToolName(a.tool) === ASK_USER_QUESTION && a.status === "done" && !a.respuesta && !a.dismissed) ?? null;
}

export function turnoNuevo(fila: string | null = null): TurnoEnVivo {
  return { fila, turnoId: null, texto: "", widgetOffsets: createWidgetOffsets(), avance: null, pregunta: false, tarjetas: [], cambioLaPagina: false, error: false, terminado: false };
}

/** Un evento del stream de /api/agent (los de `AgentStreamEvent` en lib/agent/loop.ts). */
export function conEvento(v: TurnoEnVivo, e: EventoSse): TurnoEnVivo {
  const d = (e.datos ?? {}) as Record<string, unknown>;
  switch (e.nombre) {
    case "turno":
      return typeof d.turnoId === "string" ? { ...v, turnoId: d.turnoId } : v;
    case "text":
      return typeof d.text === "string" ? { ...v, texto: v.texto + d.text } : v;
    case "widget_preview": {
      const code = typeof d.code === "string" ? d.code : "";
      if (!code) return v;
      const callIndex = typeof d.callIndex === "number" ? d.callIndex : 0;
      const offsets = v.widgetOffsets ?? createWidgetOffsets();
      const textOffset = offsets.preview(callIndex, v.texto.length);
      const loadingMessages = Array.isArray(d.loadingMessages)
        ? d.loadingMessages.filter((m): m is string => typeof m === "string")
        : [];
      return {
        ...v,
        widgetOffsets: offsets,
        liveWidget: {
          title: typeof d.title === "string" ? d.title : null,
          loadingMessages,
          code,
          textOffset,
        },
      };
    }
    case "action": {
      if (typeof d.tool !== "string") return v;
      const status = d.status === "running" || d.status === "error" || d.status === "warning" ? d.status : "done";
      const entregado = d.tool === "present" ? deliveredFrom(d.delivered) : null;
      const ref = subagentRefFrom(d.subagent);
      const pedido = d.tool === "ask_len" ? lenRequestRefFrom(d.lenRequest) : null;
      const isFinalWidget = d.tool === SHOW_WIDGET && status !== "running";
      const widget = isFinalWidget ? widgetFrom(d.widget) : null;
      const offsets = isFinalWidget ? (v.widgetOffsets ?? createWidgetOffsets()) : v.widgetOffsets;
      const textOffset = isFinalWidget ? offsets!.card(v.texto.length) : null;
      const accion: NonNullable<StoredChatTurn["actions"]>[number] = {
        tool: d.tool, status, summary: typeof d.summary === "string" ? d.summary : "",
        ...(entregado ? { delivered: entregado } : {}),
        ...(ref ? { subagent: ref } : {}),
        ...(pedido ? { lenRequest: pedido } : {}),
        ...(widget ? { widget } : {}),
        ...(textOffset !== null ? { textOffset } : {}),
        ...(Array.isArray(d.todos) ? { todos: d.todos.filter((x): x is { content: string; status: "pending" | "in_progress" | "completed" } => !!x && typeof x === "object" && typeof x.content === "string" && ["pending", "in_progress", "completed"].includes(x.status)) } : {}),
      };
      const acciones = [...(v.acciones ?? [])];
      // Same rule as `upsertActionInto`: a final card replaces the oldest matching `running` card so parallel calls keep server order.
      const i = accion.status !== "running" ? acciones.findIndex((a) => a.tool === accion.tool && a.status === "running") : -1;
      if (i >= 0) acciones[i] = accion;
      else acciones.push(accion);
      v = { ...v, acciones, ...(offsets ? { widgetOffsets: offsets } : {}), ...(isFinalWidget ? { liveWidget: undefined } : {}) };
      if (currentToolName(d.tool) === ASK_USER_QUESTION) return { ...v, pregunta: d.status !== "error" && !d.respuesta && !d.dismissed, avance: null };
      // La línea la cambia la siguiente herramienta, no el final de ésta: así no parpadea vacía entre una y otra.
      return d.status === "running" || v.avance === null ? { ...v, avance: d.tool } : v;
    }
    case "confirm": {
      const tarjeta = tarjetaDeConfirmacion(d);
      return tarjeta ? { ...v, tarjetas: [...v.tarjetas, tarjeta] } : v;
    }
    case "mcp_approval": {
      const card = mcpApprovalFrom(d.card);
      return card ? { ...v, tarjetas: [...v.tarjetas, { tipo: "conectarMcp", card }] } : v;
    }
    case "html":
      return { ...v, cambioLaPagina: true };
    case "error":
      return { ...v, error: true, terminado: true, avance: null };
    case "done":
      return { ...v, terminado: true, avance: null };
    default:
      return v;
  }
}

/** Lo que el turno en vivo pone en el hilo. `t`: ahora — el turno que corre es siempre lo último. */
export function elementosDelTurno(v: TurnoEnVivo, t: number): ElementoDelHilo[] {
  const s: ElementoDelHilo[] = elementosDeRespuesta(v.fila ?? "vivo", v.texto, v.acciones, v.liveWidget, t, "vivo:len");
  const refs = subagentRefsOf(v.acciones);
  if (refs.length && v.fila) s.push({ clave: "vivo:subagentes", t, tipo: "subagentes", fila: v.fila, refs });
  const pedidos = lenRequestRefsOf(v.acciones);
  if (pedidos.length) s.push({ clave: "vivo:lenPedidos", t, tipo: "lenPedidos", refs: pedidos });
  const entregado = deliveredOf(v.acciones);
  if (entregado.length) s.push({ clave: "vivo:entregado", t, tipo: "entregado", archivos: entregado });
  v.tarjetas.forEach((tarjeta, i) => s.push({ clave: `vivo:tarjeta:${i}`, t, tipo: "tarjeta", tarjeta }));
  if (v.error) s.push({ clave: "vivo:fallo", t, tipo: "fallo" });
  else if (v.terminado && v.cambioLaPagina) s.push({ clave: "vivo:ver", t, tipo: "verEnTuPagina" });
  return s;
}

/** Junta las partes por hora (a la misma hora, en el orden de las partes y
 *  dentro de cada una) y pone el separador de cada día. */
export function hiloCompleto(partes: ElementoDelHilo[][], diaDe: (t: number) => string): ElementoDelHilo[] {
  const todos = partes.flatMap((p, k) => p.map((e, i) => ({ e, k, i })));
  todos.sort((a, b) => a.e.t - b.e.t || a.k - b.k || a.i - b.i);
  const salida: ElementoDelHilo[] = [];
  let dia = "";
  for (const { e } of todos) {
    const d = diaDe(e.t);
    if (d !== dia) {
      dia = d;
      salida.push({ clave: `dia:${d}`, t: e.t, tipo: "dia", dia: d });
    }
    salida.push(e);
  }
  return salida;
}

export function diaLocal(t: number): string {
  const f = new Date(t);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
}

export function cualDia(dia: string, hoy: string): "hoy" | "ayer" | "otro" {
  if (dia === hoy) return "hoy";
  const ayer = new Date(`${hoy}T12:00:00Z`);
  ayer.setUTCDate(ayer.getUTCDate() - 1);
  return ayer.toISOString().slice(0, 10) === dia ? "ayer" : "otro";
}

export function marcar(
  ls: ElementoDelHilo[],
  clave: string,
  c: { estado?: EstadoLocal; transcripcion?: string } & Enviado,
): ElementoDelHilo[] {
  const enviado = { ...(c.fila !== undefined ? { fila: c.fila } : {}), ...(c.correccion ? { correccion: true } : {}) };
  return ls.map((e) => {
    if (e.clave !== clave) return e;
    if (e.tipo === "tu") return { ...e, ...(c.estado ? { estado: c.estado } : {}), ...enviado };
    if (e.tipo === "voz") {
      return { ...e, ...(c.estado ? { estado: c.estado } : {}), ...(c.transcripcion !== undefined ? { transcripcion: c.transcripcion } : {}), ...enviado };
    }
    return e;
  });
}

/** Lo que ya salió y la conversación releída YA TRAE se quita de lo local:
 *  desde ahí lo pinta ella. Por su fila, no por «ya salió»: la conversación
 *  que se pidió al acabar el turno anterior puede llegar DESPUÉS de que
 *  mandes otro, y no lo trae (el «1» que desaparecía, 01/10). Una corrección
 *  espera a que su turno se cierre: el servidor la escribe en la fila
 *  (`↳ …`) a ratos mientras trabaja y entera al cerrar. Lo que falló se
 *  queda, con su «Reintentar». */
export function sinLoEnviado(ls: ElementoDelHilo[], conversacion: StoredChatTurn[]): ElementoDelHilo[] {
  const traida = (e: Enviado) => conversacion.some((t) => t.id === e.fila && (!e.correccion || !t.enCurso));
  return ls.filter((e) => !((e.tipo === "tu" || e.tipo === "voz") && e.estado === "ok" && traida(e)));
}

// La herramienta → la frase bajo su nombre (movil.chat.avance.*). `summary`
// del evento no sirve: trae códigos («no-mirado», «regresion»), no frases.
const AVANCES: Record<string, string> = {
  Read: "leyendo",
  Grep: "leyendo",
  Glob: "leyendo",
  Edit: "cambiando",
  Write: "cambiando",
  edit_image: "cambiando",
  view_page: "comprobando",
  use_page: "comprobando",
  verificar_diseno: "comprobando",
  find_photo: "fotos",
  leer_de_internet: "internet",
  get_visits: "visitas",
  list_form_submissions: "formularios",
  list_messages: "mensajes",
  draft_reply: "borrador",
  publish: "publicar",
  toggle_module: "modulo",
  undo_last_change: "deshaciendo",
};

export function claveDeAvance(herramienta: string | null): string | null {
  // Con el nombre de hoy: una fila guardada antes del 2026-10-06 trae el de antes.
  return herramienta ? (AVANCES[currentToolName(herramienta)] ?? "trabajando") : null;
}
