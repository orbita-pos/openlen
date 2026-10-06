// QUÉ ESTÁ HACIENDO LEN AHORA — la barra viva del chat nuevo (plans/new-chat/),
// junto al compositor: la cara de Len, un verbo («Buscando fotos»), el reloj y,
// cuando toca, el motivo («Esperando tu respuesta · Te toca»).
//
// Puro a propósito: sale del último turno y de si hay uno trabajando, y lo
// prueba vitest. El verbo sale de la herramienta que corre AHORA (la última
// tarjeta `running`); sin ninguna, de si Len ya está escribiendo o aún piensa.
// Es la forma de la barra de estado de Claude Code: dice qué hace, no cómo.

import type { DesignTurn } from "./use-agent-chat";
import { asksTheOwner, questionText, type UserQuestion } from "@/lib/agent/ask-user-question";
import { currentToolName } from "@/lib/agent/tool-renames";

/** Qué clase de trabajo hace la herramienta, en palabras de quien no programa. */
export type Activity =
  | "reading"
  | "editing"
  | "terminal"
  | "photos"
  | "image"
  | "web"
  | "checking"
  | "publishing"
  | "remembering"
  | "results"
  | "reply"
  | "module"
  | "undoing"
  | "asking"
  | "working";

/** Los estados de la cara (`brand/len-cara/cara.js`) que usa el chat. */
export type FaceState =
  | "reposo"
  | "pensando"
  | "escribiendo"
  | "buscando"
  | "mirando"
  | "revisando"
  | "preguntando"
  | "terminado"
  | "publicado"
  | "error";

const ACTIVITY_OF: Readonly<Record<string, Activity>> = {
  leer_estado: "reading",
  Read: "reading",
  Grep: "reading",
  Glob: "reading",
  view_page: "reading",
  buscar_en_pagina: "reading",
  Edit: "editing",
  Write: "editing",
  editar_pagina: "editing",
  editar_texto: "editing",
  editar_atributos: "editing",
  editar_html: "editing",
  editar_runtime: "editing",
  crear_pagina: "editing",
  trabajar_en_pagina: "editing",
  cambiar_tema: "editing",
  aplicar_tematica: "editing",
  redisenar_pagina: "editing",
  guardar_dato: "editing",
  editar_dato: "editing",
  quitar_dato: "editing",
  bash: "terminal",
  find_photo: "photos",
  edit_image: "image",
  web_search: "web",
  web_fetch: "web",
  leer_de_internet: "web",
  verificar_diseno: "checking",
  use_page: "checking",
  publish: "publishing",
  recordar_preferencia: "remembering",
  get_visits: "results",
  list_form_submissions: "results",
  list_messages: "results",
  draft_reply: "reply",
  toggle_module: "module",
  conectar_datos_vivos: "module",
  undo_last_change: "undoing",
  preguntar: "asking",
  // Pieza 3 de Len 2.5: el nombre de hoy (`preguntar` se queda por lo guardado).
  ask_user_question: "asking",
  // Pieza 7: pedir planear y presentar el plan también le preguntan al dueño.
  enter_plan_mode: "asking",
  exit_plan_mode: "asking",
  // Pieza 5: buscar y leer en las charlas pasadas es leer.
  session_search: "reading",
  session_event_search: "reading",
  session_event_read: "reading",
};

export function activityOf(tool: string): Activity {
  // Con el nombre de hoy: una fila guardada antes del 2026-10-06 trae el de antes.
  return ACTIVITY_OF[currentToolName(tool)] ?? "working";
}

const FACE_OF: Readonly<Record<Activity, FaceState>> = {
  reading: "mirando",
  editing: "escribiendo",
  terminal: "escribiendo",
  photos: "buscando",
  image: "escribiendo",
  web: "buscando",
  checking: "revisando",
  publishing: "escribiendo",
  remembering: "escribiendo",
  results: "mirando",
  reply: "escribiendo",
  module: "escribiendo",
  undoing: "escribiendo",
  asking: "preguntando",
  working: "escribiendo",
};

export type LiveStatus =
  /** Nada en marcha y nada pendiente: la barra no se pinta. */
  | { readonly kind: "idle"; readonly face: FaceState }
  /** Trabajando y todavía sin decir nada ni usar nada. */
  | { readonly kind: "thinking"; readonly face: FaceState; readonly startedAt: number | null }
  /** Trabajando: con herramienta (`activity`) o escribiendo (`activity` null). */
  | {
      readonly kind: "working";
      readonly face: FaceState;
      readonly activity: Activity | null;
      readonly startedAt: number | null;
      /** Sigue en el servidor y esta vista no tiene su stream (Len 2.1). */
      readonly onServer: boolean;
      /** Lo que lleva escrito de la página el camino de reserva (`ai-design`
       *  gotea el documento): «Escribiendo la página · 12,3k caracteres» (C3).
       *  Sólo está si hay algo. */
      readonly streamedChars?: number;
    }
  /** El turno acabó preguntando: te toca. `question` es la pregunta. */
  | {
      readonly kind: "waiting";
      readonly face: FaceState;
      readonly reason: "question";
      readonly question: string;
      /** Pieza 3: la pregunta espera DENTRO del turno (`ask_user_question`):
       *  Len sigue en cuanto contestes, y el ■ sigue valiendo. */
      readonly live?: true;
      /** Pieza 7: es la revisión del plan o el consentimiento para entrar. Su
       *  `question` es el inglés del servidor; la barra dice la suya traducida. */
      readonly intent?: "plan-review" | "plan-consent";
    }
  /** El turno dejó una tarjeta de publicar sin tocar: te toca aprobarla. */
  | { readonly kind: "waiting"; readonly face: FaceState; readonly reason: "publish"; readonly question: null }
  /** Acabó bien. */
  | { readonly kind: "done"; readonly face: FaceState }
  /** Lo paraste tú (o se cortó): lo que hizo, hecho está. */
  | { readonly kind: "stopped"; readonly face: FaceState }
  /** No pudo terminar. */
  | { readonly kind: "failed"; readonly face: FaceState; readonly message: string | null }
  // El proveedor no contestó y el bucle repite el paso (`retry`, como DeepSeek).
  // `until`: cuándo acaba la espera (reloj del navegador); ver `retryPhase`.
  | { readonly kind: "retrying"; readonly face: FaceState; readonly attempt: number; readonly maxAttempts: number; readonly until: number }
  // Len resume lo más viejo de la conversación para seguir (`compaction_start`,
  // como DeepSeek): «Ordenando lo que lleva».
  | { readonly kind: "compacting"; readonly face: FaceState };

/** ¿Len está trabajando? Es lo que enseña el ■ y el reloj de la barra. Un
 *  reintento es trabajo: el ■ no puede desaparecer justo mientras espera. Ni
 *  mientras ordena lo que lleva: es una llamada al modelo, y se cobra. */
export function isRunning(status: LiveStatus): boolean {
  return (
    status.kind === "thinking" ||
    status.kind === "working" ||
    status.kind === "retrying" ||
    status.kind === "compacting" ||
    // Pieza 3: esperando tu respuesta DENTRO del turno, el turno sigue abierto.
    (status.kind === "waiting" && status.reason === "question" && status.live === true)
  );
}

/** La fase de un reintento: esperando («Reintentando · en X s», como Claude
 *  Code) o ya con el intento nuevo en marcha («Pensando»), que es lo que pasa
 *  en cuanto vence la espera aunque todavía no haya llegado texto. */
export function retryPhase(
  status: Extract<LiveStatus, { kind: "retrying" }>,
  now: number,
): { readonly waiting: true; readonly seconds: number } | { readonly waiting: false } {
  return now < status.until ? { waiting: true, seconds: Math.max(1, Math.ceil((status.until - now) / 1000)) } : { waiting: false };
}

/** La tarjeta con la que acabó el turno si acabó PREGUNTANDO: la última, de
 *  la herramienta de preguntar (con su nombre de hoy o el de antes), que no
 *  falló y que nadie contestó dentro del turno (pieza 3: con `respuesta`, Len
 *  ya la tuvo y siguió). */
function lastQuestion(turn: Pick<DesignTurn, "actions" | "status">) {
  if (turn.status !== "applied") return null;
  const last = turn.actions?.[turn.actions.length - 1];
  // Alinear con DeepSeek: una CANCELADA (`dismissed`) ya no espera a nadie.
  if (!last || !asksTheOwner(last.tool) || last.status === "error" || last.respuesta || last.dismissed) return null;
  return last;
}

/** La pregunta con la que acabó el turno, si acabó preguntando. */
export function questionOf(turn: Pick<DesignTurn, "actions" | "status">): string | null {
  const last = lastQuestion(turn);
  return last ? last.pregunta?.trim() || "" : null;
}

/** Y sus opciones, para que la tarjeta se conteste con un toque (pieza 3). */
export function questionsOf(turn: Pick<DesignTurn, "actions" | "status">): UserQuestion[] | null {
  return lastQuestion(turn)?.preguntas ?? null;
}

export function liveStatus(
  latest: DesignTurn | undefined,
  o: {
    readonly busy: boolean;
    /** Las tarjetas de publicar que el usuario ya resolvió (publicó o canceló). */
    readonly settledConfirms?: ReadonlySet<string>;
    /** Texto del error «Cancelado.»: así se distingue parar de fallar. */
    readonly cancelledText?: string;
  },
): LiveStatus {
  if (!latest) return { kind: "idle", face: "reposo" };
  if (latest.status === "streaming" || o.busy) {
    if (latest.retrying) {
      return {
        kind: "retrying",
        face: "pensando",
        attempt: latest.retrying.attempt,
        maxAttempts: latest.retrying.maxAttempts,
        until: latest.retrying.until,
      };
    }
    if (latest.compacting) return { kind: "compacting", face: "revisando" };
    // PIEZA 3: la pregunta espera DENTRO del turno: te toca, aunque el turno siga.
    if (latest.pendingQuestions?.length && !latest.answeredLive) {
      const intent = latest.pendingQuestions[0]?.intent?.kind;
      return {
        kind: "waiting",
        face: "preguntando",
        reason: "question",
        question: questionText(latest.pendingQuestions),
        live: true,
        ...(intent ? { intent } : {}),
      };
    }
    const startedAt = latest.startedAt ?? null;
    const running = [...(latest.actions ?? [])].reverse().find((a) => a.status === "running");
    if (running) {
      const activity = activityOf(running.tool);
      return { kind: "working", face: FACE_OF[activity], activity, startedAt, onServer: latest.enServidor === true };
    }
    const chars = latest.streamedChars ?? 0;
    // Si ya escribió la página, no está pensando (N34): el `done` de ai-design
    // cambia el texto por su `reasoning` final, que puede venir vacío, y la barra
    // volvía a «Pensando» mientras se disolvía el barrido.
    if (latest.assistantReasoning.length === 0 && (latest.actions?.length ?? 0) === 0 && !latest.enServidor && chars === 0) {
      return { kind: "thinking", face: "pensando", startedAt };
    }
    return {
      kind: "working",
      face: "escribiendo",
      activity: null,
      startedAt,
      onServer: latest.enServidor === true,
      ...(chars > 0 ? { streamedChars: chars } : {}),
    };
  }
  if (latest.status === "error") {
    if (o.cancelledText && latest.errorText === o.cancelledText) return { kind: "stopped", face: "reposo" };
    return { kind: "failed", face: "error", message: latest.errorText ?? null };
  }
  if (latest.status === "applied") {
    const question = questionOf(latest);
    if (question !== null) {
      const intent = questionsOf(latest)?.[0]?.intent?.kind;
      return { kind: "waiting", face: "preguntando", reason: "question", question, ...(intent ? { intent } : {}) };
    }
    if (latest.confirm && !o.settledConfirms?.has(latest.id)) {
      return { kind: "waiting", face: "preguntando", reason: "publish", question: null };
    }
    if (latest.cortado) return { kind: "stopped", face: "reposo" };
    return { kind: "done", face: "terminado" };
  }
  return { kind: "idle", face: "reposo" };
}
