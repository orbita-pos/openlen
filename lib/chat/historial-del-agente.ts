// lib/chat/historial-del-agente.ts — el historial que el Chat le manda al
// Agente, armado en UN sitio.
//
// Lo usan dos: el taller (`chat-panel.tsx`), en cada envío, y el arnés de evals,
// para reproducir una conversación con la forma EXACTA que viaja en producción
// (X1 de `plans/auditoria-len-vs-claude-code-2026-09-22.md`). Hasta el
// 2026-09-22 vivía en línea dentro del panel y la batería sólo podía mandar
// `history: []`: ningún caso podía medir qué hace Len con lo que se habló
// antes. Copiarlo al arnés habría dejado dos historiales con el mismo nombre y,
// el día que uno cambiara, una batería midiendo una conversación que el
// producto ya no manda.
//
// Puro y sin dependencias de servidor: lo importa un componente de cliente.

import { CHAT_HISTORY_TURNS } from "./history-window";

/** Un mensaje del historial reproducido. Los dos campos de herramienta viajan
 *  sólo en los turnos que de verdad usaron una — ver el comentario largo de
 *  `historialParaElAgente`. El servidor los VALIDA contra el catálogo real; nada
 *  de lo que manda el navegador se ejecuta. */
export interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
  functionCalls?: { name: string; args: Record<string, unknown> }[];
  functionResponses?: { name: string; response: Record<string, unknown> }[];
}

/** Lo mínimo de un turno del Chat que hace falta para reproducirlo. */
export interface TurnoParaHistorial {
  readonly userText: string;
  readonly assistantReasoning?: string;
  readonly status: string;
  readonly page?: string | null;
  readonly actions?: readonly {
    readonly tool: string;
    readonly status: string;
    readonly summary: string;
    readonly valores?: string;
  }[];
  /** El turno se CORTÓ a medias (ver `corteDelTurno`). */
  readonly cortado?: boolean;
}

/**
 * LA MARCA DE UN TURNO CORTADO, para el modelo. Sin ella, el historial le
 * enseñaba un turno suyo con llamadas que salieron bien y —en el de producción
 * del 14/09— sin una palabra, y al «¿ya quedó?» siguiente contestaba un Len que
 * creía haber terminado (H05 de la auditoría del 2026-09-22). En Claude Code,
 * interrumpir deja una marca que el turno siguiente ve.
 *
 * Va al MODELO, no al usuario: al dueño se lo dice el panel en su idioma.
 */
export const MARCA_DE_TURNO_CORTADO =
  "[Este turno se CORTÓ antes de terminar —plazo o conexión—: sólo quedó hecho lo de las llamadas de abajo, y lo demás NO llegó a hacerse. Si te preguntan cómo quedó, mira la página antes de contestar.]";

/** Dos slugs apuntan al mismo documento; null/undefined = la Home. Una sola
 *  definición: la comparten este historial y la decisión de Deshacer
 *  (`components/workspace-v2/panels/undo-turn.ts`). */
export function mismaPagina(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * EL HISTORIAL, CON LA FORMA QUE DE VERDAD TUVO.
 *
 * Antes esto emitía dos mensajes planos por turno y tiraba las llamadas a
 * herramientas. Efecto MEDIDO el 2026-08-22, mismo prompt y misma página,
 * variando sólo el historial: con las llamadas puestas el Agente editó 10 de 12
 * veces; sin ellas, 1 de 12 — y en los 11 fallos respondió «Listo ✅ añadí el
 * teléfono» sobre una página intacta.
 *
 * La causa es que le reescribíamos su propio pasado para que pareciera que nunca
 * usó una herramienta, y a los pocos turnos lo copiaba. Es la regla que la
 * documentación de la API enuncia para las llamadas en paralelo — reproducir mal
 * el historial entrena el comportamiento futuro — llevada al extremo.
 *
 * El resultado que se reproduce es el RESUMEN de la tarjeta, no la carga real:
 * los resultados de verdad son documentos HTML enteros y mandar seis turnos de
 * eso reventaría el contexto. Estructura sí, carga no.
 *
 * LA CHARLA NO SE REINICIA AL CAMBIAR DE PÁGINA. Antes el historial se filtraba
 * por página: pasabas de la home a /menu y la conversación arrancaba de CERO —
 * mismo proyecto, misma sesión, mismo minuto. Para el usuario eso es «no me
 * conoce». El filtro existía por una razón buena —que un turno sobre la home no
 * confunda una edición de /menu— pero la cura correcta no es esconder el turno:
 * es DECIR de qué página fue.
 *
 * `historyTotal` es cuántos turnos tiene la charla de VERDAD. Viaja aparte para
 * que el modelo pueda decir «de eso ya no me acuerdo» en vez de contestar con el
 * turno más viejo que le quede a mano — que es lo que hacía, con total seguridad
 * y equivocándose (medido el 2026-08-22).
 */
/** Cuántos mensajes del dueño anteriores a la ventana viajan, y cuánto de
 *  cada uno. Son sus palabras, no un resumen: se pagan en cada turno. */
const MAX_DICHO_ANTES = 20;
const MAX_CARACTERES_DICHO = 300;

export function historialParaElAgente(
  turnos: readonly TurnoParaHistorial[],
  paginaDelTurno: string | null | undefined,
): { history: HistoryEntry[]; historyTotal: number; dichoAntes: string[] } {
  const relevantes = turnos.filter((t) => t.status === "applied" || t.status === "reverted");
  // 🔴 H08-a · LO QUE EL DUEÑO DIJO Y YA NO CABE. La ventana es de doce turnos
  // y lo que se cae no deja rastro: un «de ahora en adelante todos los precios
  // con MXN» dicho en el turno 2 de 14 no llegaba al modelo de ninguna forma
  // (C14 de la auditoría del 2026-09-22). Claude Code resume con el modelo
  // cuando se le llena el contexto; aquí se conservan las palabras del dueño tal
  // cual —sin llamada de modelo y sin almacén nuevo—, que es lo que ese resumen
  // tendría que haber guardado.
  const fuera = relevantes.slice(0, Math.max(0, relevantes.length - CHAT_HISTORY_TURNS));
  const dichoAntes = fuera
    .map((t) => t.userText.trim().slice(0, MAX_CARACTERES_DICHO))
    .filter(Boolean)
    .slice(-MAX_DICHO_ANTES);
  const history = relevantes.slice(-CHAT_HISTORY_TURNS).flatMap((t) => {
    // 🔴 LO QUE FALLÓ TAMBIÉN CUENTA. Esto filtraba a `status === "done"`, así
    // que una herramienta que falló no viajaba en el historial de NINGUNA forma:
    // el modelo no la veía fallar, la veía no existir. Y las que sí viajaban se
    // marcaban `ok: true` a mano — o sea que el recuerdo que el modelo tenía de
    // sus propios turnos era «todo salió bien, siempre». Ahora viaja lo que
    // terminó —con su resultado de verdad— y sólo se queda fuera lo que aún
    // corría.
    const hechas = (t.actions ?? []).filter((a) => a.status !== "running");
    // El turno de OTRA página viaja etiquetado: el modelo necesita saber que
    // aquello no fue sobre el documento que tiene delante.
    const etiqueta = mismaPagina(t.page, paginaDelTurno) ? "" : `[en la página "${t.page ?? "inicio"}"] `;
    const turno: HistoryEntry[] = [
      { role: "user", content: `${etiqueta}${t.userText}` },
      {
        role: "assistant",
        content: t.cortado
          ? [MARCA_DE_TURNO_CORTADO, t.assistantReasoning].filter(Boolean).join("\n")
          : t.assistantReasoning || "",
        ...(hechas.length ? { functionCalls: hechas.map((a) => ({ name: a.tool, args: {} })) } : {}),
      },
    ];
    // El mensaje de respuestas va INMEDIATAMENTE después: el serializador del
    // proveedor empareja llamadas y respuestas por POSICIÓN, y una respuesta sin
    // llamada que la reclame degrada a texto suelto.
    if (hechas.length) {
      turno.push({
        role: "user",
        content: "",
        functionResponses: hechas.map((a) => ({
          name: a.tool,
          // El resultado DE VERDAD, no un `true` escrito a mano. Con los
          // valores que aplicó, si la herramienta los dio (H08-b): el
          // historial borra los argumentos, y sin esto el color exacto se
          // perdía.
          response: { ok: a.status !== "error", resumen: a.valores ? `${a.summary} (${a.valores})` : a.summary },
        })),
      });
    }
    return turno;
  });
  return { history, historyTotal: relevantes.length, dichoAntes };
}
