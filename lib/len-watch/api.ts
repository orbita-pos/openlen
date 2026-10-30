// What the three Len Watch routes share: who asks (the web's session or Len mobile's key), whether
// they may, and the project's incident as the clients read it.
import "server-only";

import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso, type AccesoAlProyecto, type Permiso } from "@/lib/projects/acceso";

import { lenWatchEnabled } from "./enabled";
import type { Incident, IncidentView } from "./types";

export function incidentView(i: Incident): IncidentView {
  return { id: i.id, status: i.status, reason: i.reason, summary: i.summary, shipsUnpublished: i.shipsUnpublished, createdAt: i.createdAt.toISOString() };
}

/** The caller and their access, or the response that ends the request (404 off, 401, the access gate's). */
export async function whoMay(req: Request, projectId: string, permiso: Permiso): Promise<{ userId: string; acceso: AccesoAlProyecto } | Response> {
  if (!lenWatchEnabled()) return Response.json({ error: "disabled" }, { status: 404 });
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const acceso = await exigirAcceso(projectId, userId, permiso);
  if (acceso instanceof Response) return acceso;
  return { userId, acceso };
}
