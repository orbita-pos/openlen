// Stop one subagent (spec local 2026-11-01-subagentes-de-len, §4.8): the ■ of its card. The turn's
// own ■ does not stop its children, as in Claude Code; this does. The child ends as `aborted` and Len
// gets its notice like any other.
//
// AUTHORIZATION: whoever launched it, or the project's owner. 404 otherwise, the same as an id that
// doesn't exist, so a stranger learns nothing.

import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { accesoAlProyecto } from "@/lib/projects/acceso";
import { runById } from "@/lib/agent/subagents/store";
import { stop } from "@/lib/agent/subagents/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const POST = paraLaApp(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "no_autenticado" }, 401);

  const { id } = await params;
  const run = id ? await runById(id) : null;
  const acceso = run ? await accesoAlProyecto(run.projectId, userId) : null;
  if (!run || !acceso || (acceso.rol !== "dueno" && run.personId !== userId)) {
    return json({ error: "no_encontrado" }, 404);
  }

  return json({ stopped: stop(id) });
});

export const OPTIONS = respuestaPrevia;
