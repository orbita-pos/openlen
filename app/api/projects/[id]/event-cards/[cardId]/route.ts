// POST /api/projects/[id]/event-cards/[cardId] — «Hazlo» or «Ahora no» on an event task's card (spec local
// 2026-11-03-len-que-avisa, §7.7). The owner or an editor; the turn runs as whoever pressed. The phone too.
import { decideAndLaunch, defaultAcceptDeps } from "@/lib/event-tasks/accept";
import { eventTasksEnabled } from "@/lib/event-tasks/enabled";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";
import { conAutorDeLaPeticion } from "@/lib/projects/autor-del-cambio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = paraLaApp(
  conAutorDeLaPeticion(
    (req: Request, _ctx: { params: Promise<{ id: string; cardId: string }> }) => usuarioDeLaPeticion(req),
    async (req: Request, { params }: { params: Promise<{ id: string; cardId: string }> }): Promise<Response> => {
      if (!eventTasksEnabled()) return Response.json({ error: "disabled" }, { status: 404 });
      const { id, cardId } = await params;
      const userId = await usuarioDeLaPeticion(req);
      if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
      const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
      const action = body?.action;
      if (action !== "accept" && action !== "dismiss") return Response.json({ error: "bad_action" }, { status: 400 });
      const acceso = await exigirAcceso(id, userId, "editar");
      if (acceso instanceof Response) return acceso;
      const r = await decideAndLaunch({ projectId: id, cardId, action, actorId: userId }, await defaultAcceptDeps());
      if (!r.ok) return Response.json({ error: r.reason }, { status: r.reason === "not_found" ? 404 : 409 });
      return Response.json({ status: r.status }, { status: r.status === "accepted" ? 202 : 200 });
    },
  ),
);

export const OPTIONS = respuestaPrevia;
