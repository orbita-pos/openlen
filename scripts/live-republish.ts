// Cron de datos vivos (spec §6): re-hornea las páginas con datos vivos en
// horario. Script FINO — toda la lógica (selección, tope, aislamiento de
// fallos, dedup) vive en lib/live/republish.ts (testeada); esto solo cablea
// las dependencias reales. Bundleado a .mjs por scripts/build-cron.mjs
// (systemd no corre tsx). Corre cada 60 min (el timer lo instala el deploy).
import { and, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { runLiveRepublish, type RepublishTarget } from "@/lib/live/republish";
import { fetchSheet } from "@/lib/live/sheet-source";
import { syncCollectionFromSheet } from "@/lib/collections/sheet-sync";
import { getCollectionSource, getDefaultCollection } from "@/lib/collections/store";
import { publishProject } from "@/lib/projects";
import type { ProjectData } from "@/lib/projects/types";
import { notifyBrokenSheet, type LiveSheetBrokenEvent } from "@/lib/live/notify-broken";
import { scheduleNotification } from "@/lib/notifications/dispatch";
import type { NotificationEvent } from "@/lib/notifications/types";

/** Escanea los proyectos PUBLICADOS y arma la lista de los que tienen datos
 *  vivos. Volumen v1 minúsculo → escaneo completo, sin índice. */
async function listTargets(): Promise<RepublishTarget[]> {
  const rows = await db
    .select({
      id: schema.projects.id,
      userId: schema.projects.userId,
      subdomain: schema.projects.subdomain,
      data: schema.projects.data,
    })
    .from(schema.projects)
    .where(and(isNotNull(schema.projects.publishedAt), isNotNull(schema.projects.subdomain)));

  const targets: RepublishTarget[] = [];
  for (const row of rows) {
    if (!row.subdomain) continue;
    const data = row.data as ProjectData;
    const valueSheetUrl =
      (data.settings as { liveData?: { sheetUrl?: string } } | undefined)?.liveData?.sheetUrl ?? null;

    const collections: RepublishTarget["collections"] = [];
    const source = await getCollectionSource(row.id);
    if (source?.sheet) {
      const col = await getDefaultCollection(row.id);
      if (col) collections.push({ collectionId: col.id, sheetUrl: source.sheet });
    }

    if (!valueSheetUrl && collections.length === 0) continue; // sin datos vivos
    targets.push({ projectId: row.id, userId: row.userId, subdomain: row.subdomain, valueSheetUrl, collections });
  }
  return targets;
}

async function main() {
  const summary = await runLiveRepublish({
    listTargets,
    fetchSheet: (url) => fetchSheet(url),
    syncCollection: (projectId, collectionId, sheetRows) =>
      syncCollectionFromSheet(projectId, collectionId, sheetRows),
    // skipFlightCheck: un barrido de N páginas no debe encolar N auditorías
    // Lighthouse contra el único slot del box (mismo criterio que el republish
    // masivo de Business).
    republish: (t) =>
      publishProject({ projectId: t.projectId, userId: t.userId, subdomain: t.subdomain, skipFlightCheck: true }),
    // El aviso al dueño de un Sheet roto se PERSISTE vía scheduleNotification
    // (dedup por su dedupeKey). El cast es el puente documentado en
    // notify-broken.ts: el evento `live_sheet_broken` aún no está en la unión
    // NotificationEvent (extender los canales de chat vivos es un follow-up),
    // así que se guarda pero no se entrega hasta entonces — nunca peor que hoy.
    notifyBroken: (t, sheetUrl, reason) =>
      notifyBrokenSheet(
        { projectId: t.projectId, ownerUserId: t.userId, sheetUrl, reason },
        {
          schedule: (event: LiveSheetBrokenEvent, dedupeKey: string) =>
            scheduleNotification(event as unknown as NotificationEvent, dedupeKey),
        },
      ),
  });
  // eslint-disable-next-line no-console
  console.log("[live-republish] " + JSON.stringify(summary));
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[live-republish] fatal", err);
  process.exit(1);
});
