// Los ficheros del proyecto, para el explorador de la lente «Código». El GET, sólo lectura;
// el PUT guarda lo editado a mano (la #18, abajo); POST, PATCH y DELETE crean,
// renombran y borran, como el explorador de VS Code (`operar-a-mano.ts`).
//
// Es el MISMO árbol que ve Len en su terminal (F1 y F5 de plans/len-agente-2026):
// sale de `cargarFicherosDeLaTerminal` (páginas, `/supabase`, `/memoria`,
// `/ajustes`) y de `soloLecturaDeLaTerminal` (`/.openlen`: resultados, bandeja,
// catálogo y versiones), así que el dueño y Len ven lo mismo, sin una
// segunda lista que se desfase. Fuera `/AGENTS.md` y `/.openlen/docs`: son el
// manual de la plataforma, no ficheros del proyecto del dueño.
//
//   GET                  → { ficheros: [{ ruta, contenido }], perezosos: [ruta] }
//   GET ?ruta=/.openlen/… → { ruta, contenido }   (los de sólo lectura se calculan al pedirlos)
//
// 401 sin sesión, 404 si el proyecto no es tuyo — el mismo par que las demás
// rutas de proyecto (ver la cabecera de `datos/route.ts`).

import { and, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { realDeps, type AgentSession } from "@/lib/agent/tools";
import { cargarFicherosDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";
import { soloLecturaDeLaTerminal } from "@/lib/agent/terminal/solo-lectura";
import { esDeLaPlataforma } from "@/lib/agent/ficheros/manual";
import { guardarAMano } from "@/lib/agent/terminal/editar-a-mano";
import { operarAMano, type ResultadoAMano } from "@/lib/agent/terminal/operar-a-mano";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const propio = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)))
    .limit(1);
  if (propio.length === 0) return json({ error: "not_found" }, 404);

  // La sesión de un turno que no existe: sólo hace falta para leer, como las herramientas.
  const sesion: AgentSession = {
    projectId: id,
    userId,
    page: null,
    ownerEmail: null,
    imageEditsThisTurn: 0,
    photoSearchesThisTurn: 0,
    busquedasVaciasSeguidas: 0,
  };
  const deps = realDeps();

  const ruta = new URL(req.url).searchParams.get("ruta");
  if (ruta !== null) {
    const soloLectura = await soloLecturaDeLaTerminal(sesion, deps);
    if (!soloLectura.rutas.includes(ruta) || esDeLaPlataforma(ruta)) return json({ error: "not_found" }, 404);
    try {
      return json({ ruta, contenido: await soloLectura.leer(ruta) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "no se pudo leer" }, 500);
    }
  }

  const [todos, soloLectura] = await Promise.all([cargarFicherosDeLaTerminal(sesion, deps), soloLecturaDeLaTerminal(sesion, deps)]);
  const ficheros = Object.entries(todos)
    .filter(([r]) => !esDeLaPlataforma(r))
    .map(([r, contenido]) => ({ ruta: r, contenido }));
  return json({ ficheros, perezosos: soloLectura.rutas.filter((r) => !esDeLaPlataforma(r)) });
}

/** Un fichero más grande que esto no se edita a mano en el navegador. */
const MAX_FICHERO = 2_000_000;

/**
 * PUT — guardar un fichero editado a mano en la lente «Código» (la #18 de
 * plans/len-agente-2026/notas/fase-5-taller.md), por el mismo camino que la
 * terminal del usuario (`lib/agent/terminal/editar-a-mano.ts`).
 *
 *   { ruta, contenido, base } → 200 { contenido }            (lo que quedó guardado)
 *                               409 { error: "cambio", actual } (cambió desde que lo abriste)
 *                               422 { error: "rechazado", detalle }
 *                               404 si no existe, 400 sin los tres, 413 si es enorme
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const propio = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)))
    .limit(1);
  if (propio.length === 0) return json({ error: "not_found" }, 404);

  let cuerpo: { ruta?: unknown; contenido?: unknown; base?: unknown };
  try {
    cuerpo = (await req.json()) as typeof cuerpo;
  } catch {
    return json({ error: "sin_cuerpo" }, 400);
  }
  const { ruta, contenido, base } = cuerpo;
  if (typeof ruta !== "string" || !ruta.startsWith("/") || typeof contenido !== "string" || typeof base !== "string") {
    return json({ error: "sin_cuerpo" }, 400);
  }
  if (contenido.length > MAX_FICHERO) return json({ error: "demasiado_grande" }, 413);

  const r = await guardarAMano(id, userId, ruta, contenido, base);
  if (r.ok) return json({ contenido: r.contenido });
  if (r.motivo === "cambio") return json({ error: "cambio", actual: r.actual }, 409);
  if (r.motivo === "rechazado") return json({ error: "rechazado", detalle: r.detalle }, 422);
  return json({ error: "not_found" }, 404);
}

/** El usuario de la sesión, si el proyecto es suyo; si no, la respuesta de error. */
async function duenoDe(id: string): Promise<string | Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const propio = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)))
    .limit(1);
  if (propio.length === 0) return json({ error: "not_found" }, 404);
  return userId;
}

const esRuta = (x: unknown): x is string => typeof x === "string" && x.startsWith("/") && x.length <= 300 && !x.includes("\0");

function respuestaDe(r: ResultadoAMano): Response {
  if (r.ok) return json({ rutas: r.rutas });
  if (r.motivo === "existe") return json({ error: "existe", rutas: r.rutas }, 409);
  if (r.motivo === "no_existe") return json({ error: "not_found" }, 404);
  if (r.motivo === "pagina") return json({ error: "pagina", rutas: r.rutas }, 409);
  return json({ error: "rechazado", detalle: r.detalle }, 422);
}

async function cuerpoDe(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const c = (await req.json()) as unknown;
    return c && typeof c === "object" ? (c as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * POST — crear un fichero vacío («Nuevo archivo»). Una página nueva
 * (`/<slug>/index.html`) nace con un documento mínimo.
 *
 *   { ruta, contenido? } → 200 { rutas } · 409 { error: "existe" } · 422 { error: "rechazado", detalle }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const userId = await duenoDe(id);
  if (typeof userId !== "string") return userId;
  const c = await cuerpoDe(req);
  if (!c || !esRuta(c.ruta) || (c.contenido !== undefined && typeof c.contenido !== "string")) return json({ error: "sin_cuerpo" }, 400);
  if (typeof c.contenido === "string" && c.contenido.length > MAX_FICHERO) return json({ error: "demasiado_grande" }, 413);
  return respuestaDe(await operarAMano(id, userId, { tipo: "crear", ruta: c.ruta, ...(typeof c.contenido === "string" ? { contenido: c.contenido } : {}) }));
}

/**
 * PATCH — renombrar o mover un fichero o una carpeta (F2).
 *
 *   { de, a } → 200 { rutas } (las nuevas) · 409 «existe» o «pagina» · 422 «rechazado» · 404
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const userId = await duenoDe(id);
  if (typeof userId !== "string") return userId;
  const c = await cuerpoDe(req);
  if (!c || !esRuta(c.de) || !esRuta(c.a)) return json({ error: "sin_cuerpo" }, 400);
  return respuestaDe(await operarAMano(id, userId, { tipo: "renombrar", de: c.de, a: c.a }));
}

/**
 * DELETE ?ruta=… — borrar un fichero o una carpeta entera (Supr). Las páginas
 * que haya dentro NO se borran aquí: vuelven en `409 { error: "pagina", rutas }`
 * y el cliente las quita con `DELETE /api/projects/[id]/pages/[slug]`.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const userId = await duenoDe(id);
  if (typeof userId !== "string") return userId;
  const ruta = new URL(req.url).searchParams.get("ruta");
  if (!esRuta(ruta) || ruta === "/") return json({ error: "sin_cuerpo" }, 400);
  return respuestaDe(await operarAMano(id, userId, { tipo: "borrar", ruta }));
}
