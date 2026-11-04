// POST /api/projects/[id]/event-cards/[cardId] — «Hazlo», «Ahora no» (with an optional note), «Volver a mirar» and
// «Retirar» on an event task's card (spec local 2026-11-03-len-que-avisa, §7.7; 2026-11-04-hazlo, §7.3, §7.6.7). The
// OWNER's: a card carries what the site's visitors sent, which only the owner sees (lib/projects/acceso.ts; final
// review I8), and applying or sending is theirs. The turn runs as them. The phone too.
import { decideAndLaunch, defaultAcceptDeps, type Press } from "@/lib/event-tasks/accept";
import { eventTasksEnabled } from "@/lib/event-tasks/enabled";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";
import { conAutorDeLaPeticion } from "@/lib/projects/autor-del-cambio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** «¿Qué cambiarías?» is a sentence or two, not a document. */
const NOTE_MAX = 1000;
const ACTIONS = new Set(["accept", "dismiss", "look_again", "withdraw_send"]);
const STATUS: Record<string, number> = { not_found: 404, daily_limit: 429 };

export const POST = paraLaApp(
  conAutorDeLaPeticion(
    (req: Request, _ctx: { params: Promise<{ id: string; cardId: string }> }) => usuarioDeLaPeticion(req),
    async (req: Request, { params }: { params: Promise<{ id: string; cardId: string }> }): Promise<Response> => {
      if (!eventTasksEnabled()) return Response.json({ error: "disabled" }, { status: 404 });
      const { id, cardId } = await params;
      const userId = await usuarioDeLaPeticion(req);
      if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
      const body = (await req.json().catch(() => null)) as { action?: unknown; note?: unknown; index?: unknown } | null;
      const action = body?.action;
      if (typeof action !== "string" || !ACTIONS.has(action)) return Response.json({ error: "bad_action" }, { status: 400 });
      const index = body?.index;
      if (action === "withdraw_send" && !(typeof index === "number" && Number.isInteger(index) && index >= 0)) return Response.json({ error: "bad_index" }, { status: 400 });
      const acceso = await exigirAcceso(id, userId, "editar");
      if (acceso instanceof Response) return acceso;
      if (acceso.rol !== "dueno") return Response.json({ error: "owner_only" }, { status: 403 });
      const who = { projectId: id, cardId, actorId: userId };
      const note = typeof body?.note === "string" ? body.note.trim().slice(0, NOTE_MAX) || null : null;
      const press: Press =
        action === "dismiss"
          ? { ...who, action, note }
          : action === "withdraw_send"
            ? { ...who, action, index: index as number }
            : { ...who, action: action === "look_again" ? "look_again" : "accept" };
      const r = await decideAndLaunch(press, await defaultAcceptDeps());
      if (!r.ok) return Response.json({ error: r.reason }, { status: STATUS[r.reason] ?? 409 });
      // Accepted: what each action did, and a launched turn's row and text, which let the chat paint it running.
      const { ok: _ok, ...answer } = r;
      return Response.json(answer, { status: r.status === "accepted" ? 202 : 200 });
    },
  ),
);

export const OPTIONS = respuestaPrevia;
