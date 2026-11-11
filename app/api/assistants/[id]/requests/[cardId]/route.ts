// «QUE LEN LO HAGA» / «AHORA NO» on a card of what visitors asked for (spec local 2026-11-06-asistente-propio, §4.3.3,
// §4.3.4). Her person's only: the press is the approval, and the Len turn it launches runs as them. Answers what the
// chat needs to paint that turn running and follow it (the row, its text, the project).
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { pressRequestCard } from "@/lib/assistants/requests/press";
import { assistantById } from "@/lib/assistants/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { conAutorDeLaPeticion } from "@/lib/projects/autor-del-cambio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** An IANA zone the runtime knows, or nothing. */
function zone(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw || raw.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: raw });
    return raw;
  } catch {
    return null;
  }
}

/** With the session or the phone's key (phase 5: her tab in Len móvil presses too). */
export const POST = paraLaApp(conAutorDeLaPeticion(
  (req: Request, _ctx: { params: Promise<{ id: string; cardId: string }> }) => usuarioDeLaPeticion(req),
  async (req: Request, { params }: { params: Promise<{ id: string; cardId: string }> }): Promise<Response> => {
    const personId = await usuarioDeLaPeticion(req);
    if (!personId) return json({ error: "unauthorized" }, 401);
    if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
    const { id, cardId } = await params;
    const a = await assistantById(id);
    if (!a || a.personId !== personId) return json({ error: "not_found" }, 404);
    const body = (await req.json().catch(() => null)) as { action?: unknown; timeZone?: unknown } | null;
    const action = body?.action;
    if (action !== "accept" && action !== "dismiss") return json({ error: "bad_action" }, 400);
    const timeZone = zone(body?.timeZone);
    const r = await pressRequestCard({ assistant: { id: a.id, name: a.name }, cardId, action, actorId: personId, ...(timeZone ? { timeZone } : {}) });
    if (!r.ok) return json({ error: r.reason }, 409);
    const { ok: _ok, ...answer } = r;
    return json(answer, r.status === "accepted" ? 202 : 200);
  },
));

export const OPTIONS = respuestaPrevia;
