// POST /api/projects/[id]/len-watch/bring — «Traer el arreglo» (spec local 2026-10-30-len-watch, §5.5 step 5): the
// fix Len published from its branch comes into the draft, when the person asks, never on its own. It answers what
// happened: brought, nothing to bring, handed to Len (it collided), or queued behind Len's live turn.
import { whoMay } from "@/lib/len-watch/api";
import { bringFix } from "@/lib/len-watch/bring";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { conAutor } from "@/lib/projects/autor-del-cambio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const { id } = await params;
  const who = await whoMay(req, id, "editar");
  if (who instanceof Response) return who;
  let body: { incidentId?: unknown } = {};
  try {
    body = (await req.json()) as { incidentId?: unknown };
  } catch {
    // no body: answered below
  }
  const incidentId = typeof body.incidentId === "string" ? body.incidentId : "";
  if (!incidentId) return Response.json({ error: "no_incident" }, { status: 400 });
  // The version it writes carries the name of whoever pressed (lib/projects/autor-del-cambio.ts).
  const r = await conAutor(who.userId, () => bringFix({ projectId: id, incidentId, actorId: who.userId }));
  if (r.status === "no_fix") return Response.json({ error: "no_fix" }, { status: 409 });
  return Response.json(r, { status: r.status === "queued" ? 202 : 200 });
});

export const OPTIONS = respuestaPrevia;
