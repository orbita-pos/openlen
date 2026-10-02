// Los ficheros del proyecto, para el explorador de la lente «Código». SÓLO LECTURA.
//
// Es el MISMO árbol que ve Len en su terminal (F1 y F5 de plans/len-agente-2026):
// sale de `cargarFicherosDeLaTerminal` (páginas, `/datos`, `/memoria`,
// `/ajustes`) y de `soloLecturaDeLaTerminal` (`/resultados`, `/bandeja`,
// `/catalogo`, `/.versiones`), así que el dueño y Len ven lo mismo, sin una
// segunda lista que se desfase. Fuera `/AGENTS.md`: es el manual de la
// plataforma, no un fichero del proyecto del dueño.
//
//   GET                  → { ficheros: [{ ruta, contenido }], perezosos: [ruta] }
//   GET ?ruta=/bandeja/… → { ruta, contenido }   (los de sólo lectura se calculan al pedirlos)
//
// 401 sin sesión, 404 si el proyecto no es tuyo — el mismo par que las demás
// rutas de proyecto (ver la cabecera de `datos/route.ts`).

import { and, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { realDeps, type AgentSession } from "@/lib/agent/tools";
import { cargarFicherosDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";
import { soloLecturaDeLaTerminal } from "@/lib/agent/terminal/solo-lectura";
import { RUTA_MANUAL } from "@/lib/agent/ficheros/manual";

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
    if (!soloLectura.rutas.includes(ruta)) return json({ error: "not_found" }, 404);
    try {
      return json({ ruta, contenido: await soloLectura.leer(ruta) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "no se pudo leer" }, 500);
    }
  }

  const [todos, soloLectura] = await Promise.all([cargarFicherosDeLaTerminal(sesion, deps), soloLecturaDeLaTerminal(sesion, deps)]);
  const ficheros = Object.entries(todos)
    .filter(([r]) => r !== RUTA_MANUAL)
    .map(([r, contenido]) => ({ ruta: r, contenido }));
  return json({ ficheros, perezosos: soloLectura.rutas });
}
