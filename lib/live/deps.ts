import "server-only";

// Cablea las dependencias REALES de runLiveRepublish (spec 2026-07-14 §6).
// Extraído de scripts/live-republish.ts `main()` (Task 12) para que el mismo
// objeto lo use el endpoint interno (prod, en proceso con la app) y el runner
// local de dev. notifyBroken se cableó en Task 14, una vez que Task 13 hizo
// live_sheet_broken un miembro válido de NotificationEvent (cero cast).
import type { RepublishDeps } from "./republish";
import { collectLiveTargets } from "./collect-targets";
import { fetchSheet } from "./sheet-source";
import { syncCollectionFromSheet } from "@/lib/collections/sheet-sync";
import { publishProject } from "@/lib/projects";
import { notifyBrokenSheet } from "./notify-broken";
import { scheduleNotification } from "@/lib/notifications/dispatch";

export function liveRepublishDeps(): RepublishDeps {
  return {
    listTargets: collectLiveTargets,
    fetchSheet: (url) => fetchSheet(url),
    syncCollection: (projectId, collectionId, sheetRows) =>
      syncCollectionFromSheet(projectId, collectionId, sheetRows),
    // skipFlightCheck: un barrido de N páginas no debe encolar N auditorías
    // Lighthouse contra el único slot del box (mismo criterio que el republish
    // masivo de Business).
    republish: (t) =>
      publishProject({ projectId: t.projectId, userId: t.userId, subdomain: t.subdomain, skipFlightCheck: true }),
    // reason (3er arg, de republish.ts) no viaja aquí: ya se registra en el
    // console.warn del caller; el evento canónico solo lleva missingCount.
    notifyBroken: (t, sheetUrl) =>
      notifyBrokenSheet(
        { projectId: t.projectId, ownerUserId: t.userId, sheetUrl, missingCount: 0 },
        { schedule: scheduleNotification },
      ),
  };
}
