import "server-only";

// La query real de "¿qué proyectos publicados tienen datos vivos?" (spec
// 2026-07-14 §6). Extraída de scripts/live-republish.ts (Task 12) para que la
// use tanto el endpoint interno (app/api/internal/live-republish, prod — corre
// EN PROCESO con la app así los crates nativos ya están cargados) como el
// runner local de dev (scripts/live-republish.ts, vía `npm run live:republish`).
import { and, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { RepublishTarget } from "./republish";
import type { ProjectData } from "@/lib/projects/types";

/** Escanea los proyectos PUBLICADOS y arma la lista de los que tienen datos
 *  vivos. Volumen v1 minúsculo → escaneo completo, sin índice. */
export async function collectLiveTargets(): Promise<RepublishTarget[]> {
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

    // ⚰️ Aquí se buscaba también el Sheet de una COLECCIÓN. Se va el 2026-08-29
    // con ellas: lo que queda son los `data-ol-live` de la página, que nunca
    // dependieron de una colección.
    if (!valueSheetUrl) continue; // sin datos vivos
    targets.push({ projectId: row.id, userId: row.userId, subdomain: row.subdomain, valueSheetUrl });
  }
  return targets;
}
