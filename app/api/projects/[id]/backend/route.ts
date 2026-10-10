// El panel del dueño (fase 6 de plans/pages-backend/design.md): en qué estado
// está el backend del proyecto y, si tiene base, sus tablas.
//
//   GET [?env=draft|live] → { status: "unavailable" | "none" }
//       | { status: "empty", url, environment, hasLive }
//       | { status: "ready", url, environment, hasLive, tables: TableInfo[] }
//   GET ?status → lo mismo SIN `tables`: lo que pide el rail para decidir si
//                 enseña el icono, sin abrir una conexión a la base del proyecto.

import { listTables } from "@/lib/backend/dashboard";
import { getEnvironment } from "@/lib/backend/environments";
import { environmentFromRequest, json, ownedBackend } from "@/lib/backend/owner-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const ob = await ownedBackend(id, environmentFromRequest(req));
  if (ob.kind === "unauthorized") return json({ error: "unauthorized" }, 401);
  if (ob.kind === "not_found") return json({ error: "not_found" }, 404);
  if (ob.kind === "unavailable" || ob.kind === "none") return json({ status: ob.kind });
  // Qué entorno se ve y si ya hay producción (spec local 2026-10-09): el panel
  // pinta su selector «Datos: prueba | reales» con esto.
  const hasLive = Boolean((await getEnvironment(id, "live"))?.provisionedAt);
  if (ob.kind === "empty") return json({ status: "empty", url: ob.url, environment: ob.environment, hasLive });
  if (new URL(req.url).searchParams.has("status")) return json({ status: "ready", url: ob.url, environment: ob.environment, hasLive });
  return json({ status: "ready", url: ob.url, environment: ob.environment, hasLive, tables: await listTables(ob.project) });
}
