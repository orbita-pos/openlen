// El panel del dueño (fase 6 de plans/pages-backend/design.md): en qué estado
// está el backend del proyecto y, si tiene base, sus tablas.
//
//   GET → { status: "unavailable" | "none" }
//       | { status: "empty", url }
//       | { status: "ready", url, tables: TableInfo[] }
//   GET ?status → lo mismo SIN `tables`: lo que pide el rail para decidir si
//                 enseña el icono, sin abrir una conexión a la base del proyecto.

import { listTables } from "@/lib/backend/dashboard";
import { json, ownedBackend } from "@/lib/backend/owner-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const ob = await ownedBackend(id);
  if (ob.kind === "unauthorized") return json({ error: "unauthorized" }, 401);
  if (ob.kind === "not_found") return json({ error: "not_found" }, 404);
  if (ob.kind === "unavailable" || ob.kind === "none") return json({ status: ob.kind });
  if (ob.kind === "empty") return json({ status: "empty", url: ob.url });
  if (new URL(req.url).searchParams.has("status")) return json({ status: "ready", url: ob.url });
  return json({ status: "ready", url: ob.url, tables: await listTables(ob.project) });
}
