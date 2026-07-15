import "server-only";

// Cablea las dependencias REALES de runLiveRepublish (spec 2026-07-14 §6).
// Extraído de scripts/live-republish.ts `main()` (Task 12) para que el mismo
// objeto lo use el endpoint interno (prod, en proceso con la app) y el runner
// local de dev. SIN notifyBroken a propósito — Task 15 lo añade cuando el
// canal de notificaciones sepa renderizar el evento live_sheet_broken (ver la
// NB en lib/live/notify-broken.ts); mientras tanto el core ya registra cada
// Sheet roto por console.warn.
import type { RepublishDeps } from "./republish";
import { collectLiveTargets } from "./collect-targets";
import { fetchSheet } from "./sheet-source";
import { syncCollectionFromSheet } from "@/lib/collections/sheet-sync";
import { publishProject } from "@/lib/projects";

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
  };
}
