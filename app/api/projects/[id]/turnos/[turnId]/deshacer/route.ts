import { auth } from "@/auth";
import { deshacerTurno } from "@/lib/projects/deshacer-turno";
import { exigirAcceso } from "@/lib/projects/acceso";
import { conAutorDeLaPeticion, quienDeLaSesion } from "@/lib/projects/autor-del-cambio";

export const runtime = "nodejs";

// POST /api/projects/<id>/turnos/<turnId>/deshacer — DESHACE UN TURNO DE LEN
// ENTERO: sus páginas y sus ficheros vuelven a como estaban al empezarlo, todo
// a la vez o nada (F2 de las apps web, spec local
// docs/superpowers/specs/2026-10-07-apps-design.md, H7;
// `lib/projects/deshacer-turno.ts`).
//
// Sin cuerpo, como restaurar una versión: lo que se restaura lo lee el
// servidor de su base, no lo manda el navegador.
//
//   200 { paginas: [{ page, html }], ficheros: [...], noSeDeshacen: [...], deshacerId }
//   404 { error: "not_found" }        — el proyecto no es de quien lo pide
//   404 { error: "sin_registro" }     — ese turno no se guardó (anterior, o podado):
//                                       el chat cae al Deshacer de siempre
//   409 { error: "ya_deshecho" }
//   409 { error: "se_solapan", rutas } — alguien cambió después algo del turno
//   409 { error: "sin_cambios", noSeDeshacen } — sólo cambió lo que no vuelve
//   503 { error: "conflicto" }        — otro guardado se coló; se puede reintentar
export const POST = conAutorDeLaPeticion(quienDeLaSesion, async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; turnId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, turnId } = await ctx.params;
  const acceso = await exigirAcceso(id, session.user.id, "editar");
  if (acceso instanceof Response) return acceso;
  const duenoId = acceso.duenoId;
  if (!id || !turnId || turnId.length > 100) return json({ error: "missing id" }, 400);

  const r = await deshacerTurno({ projectId: id, userId: duenoId, turnId });
  if (r.ok) {
    return json({ paginas: r.paginas, ficheros: r.ficheros, noSeDeshacen: r.noSeDeshacen, deshacerId: r.deshacerId }, 200);
  }
  switch (r.motivo) {
    case "no_encontrado":
      return json({ error: "not_found" }, 404);
    case "sin_registro":
      return json({ error: "sin_registro" }, 404);
    case "ya_deshecho":
      return json({ error: "ya_deshecho" }, 409);
    case "se_solapan":
      return json({ error: "se_solapan", rutas: r.rutas }, 409);
    case "sin_cambios":
      return json({ error: "sin_cambios", noSeDeshacen: r.noSeDeshacen }, 409);
    case "conflicto":
      return json({ error: "conflicto" }, 503);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
