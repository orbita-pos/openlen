// Los datos de un proyecto, para SU DUEÑO, desde el taller.
//
// DISTINTA DE /api/d/[sub]/[store] A PROPÓSITO. Aquélla la llama la página
// publicada y se autoriza por el subdominio de origen; ésta la llama el taller y
// se autoriza por sesión + propiedad del proyecto. Un solo endpoint con dos
// modelos de autorización es exactamente por donde se cuela el que no toca.
//
// 401 sin sesión, 404 si el proyecto no es tuyo — el mismo par que usan las
// otras rutas de proyecto. Un 403 confirmaría que ese proyecto EXISTE, que ya es
// más de lo que un extraño debería poder averiguar cambiando un id en la URL.

import { and, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { declaracionPublicada } from "@/lib/page-data/publicada";
import { agregarDato, editarDato, leerDatos, quitarDato } from "@/lib/page-data/agente";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function owns(projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** La sesión y el proyecto, o la Response que corresponde. El plan NO se
 *  resuelve aquí: lo hace `lib/page-data/agente.ts` desde el `userId`, para que
 *  exista un solo sitio donde se decide la cuota. */
async function guardia(
  projectId: string,
): Promise<{ userId: string } | Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!(await owns(projectId, userId))) return json({ error: "not_found" }, 404);
  return { userId };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const ctx = await guardia(id);
  if (ctx instanceof Response) return ctx;

  const declaracion = await declaracionPublicada(id);
  const almacenes: Record<string, unknown> = {};
  for (const [nombre, a] of Object.entries(declaracion)) {
    almacenes[nombre] = {
      modo: a.modo,
      campos: a.campos,
      caducaDias: a.caducaDias,
      filas: await leerDatos({ projectId: id, almacen: nombre }),
    };
  }
  return json({ ok: true, almacenes });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const ctx = await guardia(id);
  if (ctx instanceof Response) return ctx;

  const body = (await req.json().catch(() => null)) as
    | { almacen?: string; datos?: Record<string, unknown> }
    | null;
  if (!body?.almacen) return json({ error: "falta_almacen" }, 422);

  const r = await agregarDato({
    projectId: id,
    userId: ctx.userId,
    almacen: body.almacen,
    doc: body.datos ?? {},
  });
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 422);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const ctx = await guardia(id);
  if (ctx instanceof Response) return ctx;

  const body = (await req.json().catch(() => null)) as
    | { almacen?: string; id?: string; datos?: Record<string, unknown> }
    | null;
  if (!body?.almacen || !body.id) return json({ error: "falta_id" }, 422);

  const r = await editarDato({
    projectId: id,
    userId: ctx.userId,
    almacen: body.almacen,
    id: body.id,
    doc: body.datos ?? {},
  });
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 422);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const ctx = await guardia(id);
  if (ctx instanceof Response) return ctx;

  const url = new URL(req.url);
  const almacen = url.searchParams.get("almacen");
  const filaId = url.searchParams.get("id");
  if (!almacen || !filaId) return json({ error: "falta_id" }, 422);

  const r = await quitarDato({ projectId: id, almacen, id: filaId });
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 404);
}
