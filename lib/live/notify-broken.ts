import "server-only";

// Aviso al dueño cuando su Google Sheet dejó de leerse (spec §7): la página
// NUNCA se rompe (conserva el último valor), pero el dueño debe enterarse de
// que su edición no surtió efecto. Dedup por (proyecto, sheet) vía la
// dedupeKey de scheduleNotification (ON CONFLICT sobre pendientes): mientras
// un aviso de ESTE sheet siga pendiente, re-agendar es un no-op — no se
// spamea cada hora.
//
// NB (follow-up, deliberado): el EVENTO `live_sheet_broken` y su render en los
// canales (webpush/email) NO se cablean aquí — extender la unión de
// NotificationEvent toca lib/notifications/channels/*, que sirve al chat VIVO
// en producción, y no se rusha. Esta función construye el evento + la dedupe
// key correctos y los entrega al `schedule` inyectado; el render del canal es
// una tarea aparte en el módulo de notificaciones. El `schedule` real
// (scheduleNotification) ya persiste el evento; hasta que el canal lo sepa
// renderizar, se registra pero no se entrega — nunca peor que hoy.

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
