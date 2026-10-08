// /api/projects/[id]/hilos — LOS HILOS EN EL CÓDIGO (lib/projects/hilos.ts).
//
// GET  ?solo=sinVer → { sinVer: { total, rutas } } — para marcar ficheros.
// GET  ?ruta=  → { hilos, personas, puedeLen, sinVer } — los del fichero (o
//               todos), a quién se puede mencionar, si quien pide puede llamar
//               a Len, y sus menciones sin ver en el proyecto.
// POST { ruta, linea, codigo, texto, menciones, len, idioma } → { hiloId, mensajeId }
//
// Lo ven y comentan el dueño y los miembros (un lector también: comentar no es
// editar); mencionar a Len, sólo quien puede editar (lib/projects/acceso.ts).
import { z } from "zod";

import { puede } from "@/lib/projects/acceso";
import { MAX_CODIGO_DEL_HILO, crearHilo, listarHilos, mencionesSinVer, personasDelProyecto } from "@/lib/projects/hilos";
import { retomarPedidosDelHilo } from "@/lib/agent/turnos-desde-el-servidor";
import { avisarMenciones, CuerpoDelMensaje, json, pedirleALen, quienEnElProyecto } from "./_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const q = await quienEnElProyecto(id);
  if (!q.ok) return q.respuesta;
  // Por si el arranque no llegó a retomar los pedidos a Len (una vez por proceso).
  void retomarPedidosDelHilo();
  const url = new URL(req.url);
  // Sólo las menciones sin ver (el explorador marca sus ficheros).
  if (url.searchParams.get("solo") === "sinVer") return json({ sinVer: await mencionesSinVer(id, q.userId) });
  const ruta = url.searchParams.get("ruta");
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
  // La línea entera llega del cliente, y un HTML pegado o minificado es UNA
  // línea de miles de caracteres: se recorta a lo que se guarda, no se rechaza
  // (un `.max` aquí no ahorra nada, el cuerpo ya está leído).
  codigo: z.string().default("").transform((c) => c.slice(0, MAX_CODIGO_DEL_HILO)),
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
  // `@Len`: el turno arranca aquí, en el servidor; el chat lo sigue si está abierto.
  const filaId = body.data.len
    ? await pedirleALen({ req, projectId: id, userId: q.userId, hiloId: escrito.hiloId, mensajeId: escrito.mensajeId, texto: body.data.texto, ...(body.data.idioma ? { idioma: body.data.idioma } : {}) })
    : null;
  return json({ hiloId: escrito.hiloId, mensajeId: escrito.mensajeId, mencionados: escrito.mencionados, filaId });
}
