// ONE OF HER PROJECTS (spec local 2026-11-06-asistente-propio, §4.5, §4.4.5): take her off it — never off her last; off
// her home, her home and her conversation move to her oldest other project — or turn her bubble on or off there. Off is
// immediate; on shows after the next publish of that project. Only her person.
import { auth } from "@/auth";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { disconnectProject } from "@/lib/assistants/projects";
import { assistantById } from "@/lib/assistants/store";
import { setOnPage } from "@/lib/assistants/visitor/store";
import { conAutorDeLaPeticion, quienDeLaSesion } from "@/lib/projects/autor-del-cambio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

type Ctx = { params: Promise<{ id: string; projectId: string }> };

async function hersAnd(ctx: Ctx): Promise<{ assistantId: string; projectId: string } | Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const { id, projectId } = await ctx.params;
  const a = await assistantById(id);
  if (!a || a.personId !== personId) return json({ error: "not_found" }, 404);
  return { assistantId: a.id, projectId };
}

export const DELETE = conAutorDeLaPeticion(quienDeLaSesion, async (_req: Request, ctx: Ctx): Promise<Response> => {
  const found = await hersAnd(ctx);
  if (found instanceof Response) return found;
  const done = await disconnectProject(found.assistantId, found.projectId);
  if (done === "not_connected") return json({ error: "not_found" }, 404);
  if (done === "only_project" || done === "busy") return json({ error: done }, 409);
  return new Response(null, { status: 204 });
});

export const PATCH = conAutorDeLaPeticion(quienDeLaSesion, async (req: Request, ctx: Ctx): Promise<Response> => {
  const found = await hersAnd(ctx);
  if (found instanceof Response) return found;
  const body = (await req.json().catch(() => null)) as { onPage?: unknown } | null;
  if (typeof body?.onPage !== "boolean") return json({ error: "bad_request" }, 400);
  if (!(await setOnPage(found.projectId, found.assistantId, body.onPage))) return json({ error: "not_found" }, 404);
  return json({ onPage: body.onPage, needsPublish: body.onPage });
});
