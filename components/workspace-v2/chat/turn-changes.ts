// QUÉ CAMBIÓ UN TURNO, sección a sección — la MISMA cuenta para los dos chats.
//
// Vivía dentro de `CambiosDelTurno` en `panels/chat-panel.tsx`; sale aquí para
// que el chat nuevo (plans/new-chat/) no la copie. La regla, sin tocar:
//
// LAS OPS MANDAN SOBRE EL DIFF, y no es una preferencia de estilo: el diff
// compara dos HTML y sólo mira los hijos de <body>, así que un cambio de CSS,
// del <title> o del comportamiento le es INVISIBLE — el turno saldría como «no
// cambió nada» habiendo cambiado. Las ops son la instrucción literal que se
// ejecutó, resuelta en el servidor mientras los op-id aún valían. El diff se
// queda como respaldo: los turnos anteriores a las ops no las traen, y la vía de
// opt-out (`ai-design`) no las emite.
//
// NO SALE NADA cuando no hay par antes/después: un turno restaurado llega sin
// preimagen, y decir «no cambió nada» sobre eso sería afirmar algo que nadie
// miró — la misma regla que el botón de Deshacer.

import { seccionesCambiadas, tipoDeOp, type SeccionCambiada } from "@/lib/workspace-v2/diff-de-turno";
import type { DesignTurn } from "./use-agent-chat";

/** Dónde cae un cambio que no es de una sección: los estilos, la cabecera… */
export type ChangePlace = "estilos" | "cabecera" | "comportamiento";

export function turnChanges(
  turn: Pick<DesignTurn, "actions" | "preEditHtml" | "postEditHtml">,
  /** El nombre del sitio («los estilos», «la cabecera»), en el idioma de quien mira. */
  placeLabel: (place: ChangePlace) => string,
): SeccionCambiada[] {
  // Una sola fuente: las acciones del turno, que es lo único del turno que se
  // guarda como JSON (un campo aparte se perdía al recargar).
  const ops = turn.actions?.flatMap((a) => a.ops ?? []) ?? [];
  if (ops.length) {
    return ops.map((o) => ({
      tipo: tipoDeOp(o.tipo),
      etiqueta: o.donde === "documento" ? o.etiqueta : placeLabel(o.donde),
      indice: o.indice,
    }));
  }
  if (!turn.preEditHtml || !turn.postEditHtml) return [];
  return seccionesCambiadas(turn.preEditHtml, turn.postEditHtml);
}

/** Las ediciones que aplicó el turno, sumadas de sus acciones (sólo `actions`
 *  sobrevive a recargar, así que se deriva de ahí). */
export function editsOfTurn(turn: Pick<DesignTurn, "actions">): number {
  return turn.actions?.reduce((n, a) => n + (a.edits ?? 0), 0) ?? 0;
}
