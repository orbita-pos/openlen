// HER OWNER SAW HER CONVERSATIONS (spec local 2026-11-06-asistente-propio, §6.5; phase 4E): her Conversaciones, on
// the web place or the phone's tab, marks the ones it showed as read, as the page's inbox does — so `list_messages` in
// her chat counts as unread only what visitors wrote after. Only her person, with the session or the phone's key; her
// visits only (another's ids are ignored); a tool never marks.
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { assistantById } from "@/lib/assistants/store";
import { markHerVisitsRead } from "@/lib/assistants/visitor/inbox";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** At most a list's worth, as `GET …/visits` gives. */
const MAX_IDS = 50;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function idsOf(body: unknown): string[] | null {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return null;
  if (!ids.every((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 100)) return null;
  return ids;
}

export const POST = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const personId = await usuarioDeLaPeticion(req);
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const ids = idsOf(await req.json().catch(() => null));
  if (!ids) return json({ error: "bad_request" }, 400);
  const { id } = await params;
  const a = await assistantById(id);
  if (!a || a.personId !== personId) return json({ error: "not_found" }, 404);
  return json({ marked: await markHerVisitsRead(a.id, ids, new Date()) });
});

export const OPTIONS = respuestaPrevia;
