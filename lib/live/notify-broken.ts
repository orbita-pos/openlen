import "server-only";

// Aviso al dueño cuando su Google Sheet dejó de leerse (spec §7): la página
// NUNCA se rompe (conserva el último valor), pero el dueño debe enterarse de
// que su edición no surtió efecto. Dedup por (proyecto, sheet) vía la
// dedupeKey de scheduleNotification (ON CONFLICT sobre pendientes): mientras
// un aviso de ESTE sheet siga pendiente, re-agendar es un no-op — no se
// spamea cada hora.
//
// ⚠️ NO CABLEADA A scheduleNotification TODAVÍA (hallazgo de la revisión
// final, 2026-07-14). Este es el UNIT preparado (evento + dedupeKey +
// never-throw), TESTEADO, para cuando el canal aprenda a renderizar el evento
// `live_sheet_broken`. Pero NO debe enchufarse a scheduleNotification tal
// cual: la unión NotificationEvent solo conoce `chat_message`, y los canales
// (lib/notifications/channels/webpush.ts, email.ts) leen event.senderName/
// preview/conversationId SIN ramificar por type — un evento live_sheet_broken
// produciría un push vacío ("/inbox?conv=undefined") y un TypeError en el
// email (.slice sobre undefined) → 2h de reintentos por cada Sheet roto. El
// follow-up (b) debe: (1) hacer NotificationEvent una unión discriminada, (2)
// ramificar por type en runJob + ambos canales, (3) recién ahí cablear el
// `schedule`. Mientras tanto, el cron registra los Sheets rotos por
// console.warn (lib/live/republish.ts) — señal en logs, sin entrega al dueño.

/** Evento del aviso — forma que el canal renderizará cuando se extienda la
 *  unión de NotificationEvent (follow-up). Se mantiene aquí para no acoplar
 *  esta función a un cambio en el sistema de notificaciones vivo. */
export interface LiveSheetBrokenEvent {
  type: "live_sheet_broken";
  projectId: string;
  recipientUserId: string;
  sheetUrl: string;
  reason: string;
}

export interface NotifyBrokenInput {
  projectId: string;
  ownerUserId: string;
  sheetUrl: string;
  reason: string;
}

export interface NotifyBrokenDeps {
  /** Inyectable para tests; el real es scheduleNotification de
   *  lib/notifications/dispatch (event, dedupeKey). */
  schedule: (event: LiveSheetBrokenEvent, dedupeKey: string) => Promise<unknown>;
}

/** Clave estable de dedup por (proyecto, sheet). */
export function brokenSheetDedupeKey(projectId: string, sheetUrl: string): string {
  return `live-broken:${projectId}:${sheetUrl}`;
}

export async function notifyBrokenSheet(input: NotifyBrokenInput, deps: NotifyBrokenDeps): Promise<void> {
  const event: LiveSheetBrokenEvent = {
    type: "live_sheet_broken",
    projectId: input.projectId,
    recipientUserId: input.ownerUserId,
    sheetUrl: input.sheetUrl,
    reason: input.reason,
  };
  try {
    await deps.schedule(event, brokenSheetDedupeKey(input.projectId, input.sheetUrl));
  } catch {
    // Un aviso que falla JAMÁS rompe la corrida del cron (spec §7).
  }
}
