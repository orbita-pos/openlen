// Lo que el modal de publicar necesita de los datos (spec local
// 2026-10-09-borrador-y-produccion-de-datos): si hay backend, si ya hay
// producción y qué cambios de tablas se aplicarían. SIN ensayar: el modal se
// abre a menudo y el ensayo bloquea tablas un instante.
//
//   GET → { hasBackend, hasLive, preview: DataChangesPreview }
//
// Entran quienes pueden publicar: el dueño y los editores (lib/projects/acceso.ts),
// como en /api/projects/[id]/publish.

import { previewDataChanges } from "@/lib/backend/data-changes";
import { getEnvironment } from "@/lib/backend/environments";
import { json } from "@/lib/backend/owner-access";
import { backendConfigured } from "@/lib/backend/pg";
import { adoptLegacyEnvironment, getBackendByProject } from "@/lib/backend/registry";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await ctx.params;
  const acceso = await exigirAcceso(id, userId, "editar");
  if (acceso instanceof Response) return acceso;
  const none = { hasBackend: false, hasLive: false, preview: { kind: "none" } };
  if (!backendConfigured()) return json(none);
  const rec = await getBackendByProject(id);
  if (!rec) return json(none);
  await adoptLegacyEnvironment(rec);
  const live = await getEnvironment(id, "live");
  return json({ hasBackend: true, hasLive: Boolean(live?.provisionedAt), preview: await previewDataChanges(id, { rehearse: false }) });
}
