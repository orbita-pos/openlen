import "server-only";
import type { LiveSheetBrokenEvent } from "@/lib/notifications/types";

// Aviso al dueño cuando su Google Sheet dejó de leerse (spec §7): la página
// NUNCA se rompe (conserva el último valor), pero el dueño debe enterarse de
// que su edición no surtió efecto. Dedup por (proyecto, sheet) vía la
// dedupeKey de scheduleNotification (ON CONFLICT sobre pendientes): mientras
// un aviso de ESTE sheet siga pendiente, re-agendar es un no-op — no se
// spamea cada hora.
//
// Task 13 hizo NotificationEvent una unión discriminada (chat_message |
// live_sheet_broken) y ramificó ambos canales por event.type — el evento que
// este módulo agenda ahora usa el tipo canónico de lib/notifications/types.
//
// ⚠️ NO CABLEADA A scheduleNotification TODAVÍA. `reason` sigue siendo un
// input de este módulo (para logging del caller, p.ej. lib/live/republish.ts
// via console.warn) pero NO viaja en el evento — el tipo canónico solo tiene
// `missingCount`. Cablear notifyBrokenSheet al cron real es Task 14.

export interface NotifyBrokenInput {
  projectId: string;
  ownerUserId: string;
  sheetUrl: string;
  /** Detalle legible para logs del caller — no viaja en el evento agendado. */
  reason: string;
  /** 0 = el sheet dejó de leerse por completo. */
  missingCount: number;
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
    missingCount: input.missingCount,
  };
  try {
    await deps.schedule(event, brokenSheetDedupeKey(input.projectId, input.sheetUrl));
  } catch {
    // Un aviso que falla JAMÁS rompe la corrida del cron (spec §7).
  }
}
