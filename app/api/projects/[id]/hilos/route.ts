// /api/projects/[id]/hilos — LOS HILOS EN EL CÓDIGO (lib/projects/hilos.ts).
//
// GET  ?ruta=  → { hilos, personas, puedeLen, sinVer } — los del fichero (o
//               todos), a quién se puede mencionar, si quien pide puede llamar
//               a Len, y sus menciones sin ver en el proyecto.
// POST { ruta, linea, codigo, texto, menciones, len, idioma } → { hiloId, mensajeId }
//
// Lo ven y comentan el dueño y los miembros (un lector también: comentar no es
// editar); mencionar a Len, sólo quien puede editar (lib/projects/acceso.ts).
import { z } from "zod";

import { puede } from "@/lib/projects/acceso";
import { crearHilo, listarHilos, mencionesSinVer, personasDelProyecto } from "@/lib/projects/hilos";
import { avisarMenciones, CuerpoDelMensaje, json, quienEnElProyecto } from "./_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const q = await quienEnElProyecto(id);
  if (!q.ok) return q.respuesta;
  const ruta = new URL(req.url).searchParams.get("ruta");
  const [hilos, personas, sinVer] = await Promise.all([
    listarHilos(id, q.userId, ruta),
    personasDelProyecto(id),
    mencionesSinVer(id, q.userId),
  ]);
  return json({ hilos, personas: personas.map(({ userId, nombre, rol }) => ({ userId, nombre, rol })), puedeLen: puede(q.acceso.rol, "editar"), sinVer, yo: q.userId });
}

const Crear = CuerpoDelMensaje.extend({
  ruta: z.string().startsWith("/").max(300),
  linea: z.number().int().min(1).max(1_000_000),
  codigo: z.string().max(2000).default(""),
});

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const q = await quienEnElProyecto(id);
  if (!q.ok) return q.respuesta;
  const body = Crear.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_body" }, 400);
  if (body.data.len && !puede(q.acceso.rol, "editar")) return json({ error: "solo_lectura", message: "Only editors can ask Len." }, 403);
  const escrito = await crearHilo({
    projectId: id,
    autorId: q.userId,
    ruta: body.data.ruta,
    linea: body.data.linea,
    codigo: body.data.codigo,
    texto: body.data.texto,
    menciones: body.data.menciones,
  });
  await avisarMenciones({
    projectId: id,
    mencionados: escrito.mencionados,
    quien: q.nombre,
    texto: body.data.texto,
    ruta: body.data.ruta,
    linea: body.data.linea,
    ...(body.data.idioma ? { idioma: body.data.idioma } : {}),
  });
  return json({ hiloId: escrito.hiloId, mensajeId: escrito.mensajeId, mencionados: escrito.mencionados });
}
