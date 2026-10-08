// /api/projects/[id]/hilos/[hiloId] — contestar un hilo, o resolverlo.
//
// POST  { texto, menciones, len, idioma } → { mensajeId } (contestar reabre un resuelto)
// PATCH { estado: "abierto" | "resuelto" } — quien puede editar, o quien lo abrió.
import { z } from "zod";

import { puede } from "@/lib/projects/acceso";
import { cambiarEstado, hiloDelProyecto, responderHilo } from "@/lib/projects/hilos";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { avisarMenciones, CuerpoDelMensaje, json, pedirleALen, quienEnElProyecto } from "../_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; hiloId: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id, hiloId } = await ctx.params;
  const q = await quienEnElProyecto(id);
  if (!q.ok) return q.respuesta;
  const body = CuerpoDelMensaje.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_body" }, 400);
  if (body.data.len && !puede(q.acceso.rol, "editar")) return json({ error: "solo_lectura", message: "Only editors can ask Len." }, 403);
  const escrito = await responderHilo({ projectId: id, hiloId, autorId: q.userId, texto: body.data.texto, menciones: body.data.menciones });
  if (!escrito) return json({ error: "not_found" }, 404);
  const hilo = await hiloDelProyecto(id, hiloId);
  if (hilo) {
    await avisarMenciones({
      projectId: id,
      mencionados: escrito.mencionados,
      quien: q.nombre,
      texto: body.data.texto,
      ruta: hilo.ruta,
      linea: hilo.linea,
      ...(body.data.idioma ? { idioma: body.data.idioma } : {}),
    });
  }
  const filaId = body.data.len
    ? await pedirleALen({ req, projectId: id, userId: q.userId, hiloId, mensajeId: escrito.mensajeId, texto: body.data.texto, ...(body.data.idioma ? { idioma: body.data.idioma } : {}) })
    : null;
  return json({ mensajeId: escrito.mensajeId, mencionados: escrito.mencionados, filaId });
}

const Estado = z.object({ estado: z.enum(["abierto", "resuelto"]) });

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id, hiloId } = await ctx.params;
  const q = await quienEnElProyecto(id);
  if (!q.ok) return q.respuesta;
  const body = Estado.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_body" }, 400);
  if (!puede(q.acceso.rol, "editar")) {
    const [h] = await db.select({ creadoPor: schema.codeThreads.creadoPor }).from(schema.codeThreads).where(eq(schema.codeThreads.id, hiloId)).limit(1);
    if (h?.creadoPor !== q.userId) return json({ error: "solo_lectura" }, 403);
  }
  return (await cambiarEstado(id, hiloId, body.data.estado)) ? json({ ok: true }) : json({ error: "not_found" }, 404);
}
