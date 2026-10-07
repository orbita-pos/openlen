import { auth } from "@/auth";
import { restoreFileVersion } from "@/lib/projects/file-versions";
import { exigirAcceso } from "@/lib/projects/acceso";
import { conAutorDeLaPeticion, quienDeLaSesion } from "@/lib/projects/autor-del-cambio";

export const runtime = "nodejs";

// POST /api/projects/<id>/ficheros/versions/<vid>/restore — LA CARPETA (pieza 9
// de Len 2.5): devuelve un fichero de la carpeta a una versión suya (o lo
// borra, si la versión dice que no existía). Es el «Deshacer» de un turno que
// tocó `js/app.js`, con la misma forma que `versions/<vid>/restore` de las
// páginas: sin cuerpo —la versión la lee el servidor de su base—, y
// `restoreFileVersion` archiva lo de ahora antes de escribir, así que el
// propio Deshacer se deshace. La propiedad la comprueba esa función, que une
// la versión con el dueño del proyecto: un id ajeno da 404.
export const POST = conAutorDeLaPeticion(quienDeLaSesion, async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; vid: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  const { id, vid } = await ctx.params;
  const acceso = await exigirAcceso(id, session.user.id, "editar");
  if (acceso instanceof Response) return acceso;
  const duenoId = acceso.duenoId;
  if (!id || !vid) return json({ error: "missing id" }, 400);

  const result = await restoreFileVersion({ projectId: id, userId: duenoId, versionId: vid });
  if (!result) return json({ error: "not found" }, 404);

  return json(result, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
