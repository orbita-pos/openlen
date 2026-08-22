import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getCollectionSource, setCollectionSource } from "@/lib/collections/store";

// DELETE /api/projects/[id]/collections/source — owner: deja de sincronizar el
// catálogo con su Google Sheet.
//
// POR QUÉ EXISTE. Conectar una hoja dejaba la colección de SOLO LECTURA
// (`isSheetBacked` → el API 409ea toda mutación manual) y no había forma de
// deshacerlo en ninguna superficie: el panel sólo ofrecía un enlace para ABRIR
// la hoja. Quien conectaba un Sheet se quedaba con su catálogo bloqueado para
// siempre, y la única salida era el kill-switch global `OPENLEN_LIVE_DATA=0`,
// que apaga los datos vivos de TODOS los proyectos del servidor.
//
// Lo que ya se sincronizó SE QUEDA. Desconectar es dejar de traer cambios, no
// vaciar el catálogo del dueño: los ítems siguen en `collectionItems` y vuelven
// a ser editables a mano. Si además quiere vaciarlo, eso son sus botones de
// borrar, uno por uno y a conciencia.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function owns(projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!(await owns(id, session.user.id))) return json({ error: "not_found" }, 404);

  // Idempotente: sin hoja conectada devuelve el mismo 200. Un botón que el
  // usuario pulsa dos veces no puede acabar en un error rojo.
  const antes = await getCollectionSource(id);
  await setCollectionSource(id, null);
  return json({ ok: true, desconectada: antes?.sheet ?? null }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
