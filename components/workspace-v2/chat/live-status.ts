// QUÉ ESTÁ HACIENDO LEN AHORA — la barra viva del chat nuevo (plans/new-chat/),
// junto al compositor: la cara de Len, un verbo («Buscando fotos»), el reloj y,
// cuando toca, el motivo («Esperando tu respuesta · Te toca»).
//
// Puro a propósito: sale del último turno y de si hay uno trabajando, y lo
// prueba vitest. El verbo sale de la herramienta que corre AHORA (la última
// tarjeta `running`); sin ninguna, de si Len ya está escribiendo o aún piensa.
// Es la forma de la barra de estado de Claude Code: dice qué hace, no cómo.

import type { DesignTurn } from "./use-agent-chat";

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
  mirar_pagina: "reading",
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
  elegir_foto: "photos",
  editar_imagen: "image",
  web_search: "web",
  web_fetch: "web",
  leer_de_internet: "web",
  verificar_diseno: "checking",
  usar_pagina: "checking",
  publicar: "publishing",
  recordar_preferencia: "remembering",
  ver_visitas: "results",
  ver_formularios: "results",
  ver_mensajes: "results",
  preparar_respuesta: "reply",
  activar_modulo: "module",
  conectar_datos_vivos: "module",
  revertir_ultimo_cambio: "undoing",
  preguntar: "asking",
};

export function activityOf(tool: string): Activity {
  return ACTIVITY_OF[tool] ?? "working";
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
  | { readonly kind: "waiting"; readonly face: FaceState; readonly reason: "question"; readonly question: string }
  /** El turno dejó una tarjeta de publicar sin tocar: te toca aprobarla. */
  | { readonly kind: "waiting"; readonly face: FaceState; readonly reason: "publish"; readonly question: null }
  /** Acabó bien. */
  | { readonly kind: "done"; readonly face: FaceState }
  /** Lo paraste tú (o se cortó): lo que hizo, hecho está. */
  | { readonly kind: "stopped"; readonly face: FaceState }
  /** No pudo terminar. */
  | { readonly kind: "failed"; readonly face: FaceState; readonly message: string | null }
  // El proveedor no contestó y el bucle repite el paso (`retry`, como DeepSeek).
  | { readonly kind: "retrying"; readonly face: FaceState; readonly attempt: number; readonly maxAttempts: number };

/** La pregunta con la que acabó el turno, si acabó preguntando. */
export function questionOf(turn: Pick<DesignTurn, "actions" | "status">): string | null {
  if (turn.status !== "applied") return null;
  const last = turn.actions?.[turn.actions.length - 1];
  if (!last || last.tool !== "preguntar" || last.status === "error") return null;
  return last.pregunta?.trim() || "";
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
      return { kind: "retrying", face: "pensando", attempt: latest.retrying.attempt, maxAttempts: latest.retrying.maxAttempts };
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
    if (question !== null) return { kind: "waiting", face: "preguntando", reason: "question", question };
    if (latest.confirm && !o.settledConfirms?.has(latest.id)) {
      return { kind: "waiting", face: "preguntando", reason: "publish", question: null };
    }
    if (latest.cortado) return { kind: "stopped", face: "reposo" };
    return { kind: "done", face: "terminado" };
  }
  return { kind: "idle", face: "reposo" };
}
