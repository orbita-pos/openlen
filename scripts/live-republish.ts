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
    const valueSheetUrl = data.settings?.liveData?.sheetUrl ?? null;

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
    // NO se cablea notifyBroken a scheduleNotification a propósito (hallazgo de
    // la revisión final, 2026-07-14): el canal (webpush/email) no sabe
    // renderizar el evento live_sheet_broken y CRASHEARÍA sobre sus campos
    // ausentes (empuje vacío / TypeError en el email → 2h de reintentos). El
    // core del cron ya registra cada Sheet roto por console.warn; la entrega
    // al dueño espera al follow-up que extienda el canal. Nunca peor que hoy.
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
