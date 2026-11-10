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

/** What it showed: each conversation's id and the `lastAt` it had on screen (final review I1: the mark goes up to that). */
function seenOf(body: unknown): { id: string; lastAt: Date }[] | null {
  const seen = (body as { seen?: unknown } | null)?.seen;
  if (!Array.isArray(seen) || seen.length === 0 || seen.length > MAX_IDS) return null;
  const out: { id: string; lastAt: Date }[] = [];
  for (const s of seen as { id?: unknown; lastAt?: unknown }[]) {
    if (typeof s?.id !== "string" || s.id.length === 0 || s.id.length > 100 || typeof s.lastAt !== "string") return null;
    const lastAt = new Date(s.lastAt);
    if (Number.isNaN(lastAt.getTime())) return null;
    out.push({ id: s.id, lastAt });
  }
  return out;
}

export const POST = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const personId = await usuarioDeLaPeticion(req);
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const seen = seenOf(await req.json().catch(() => null));
  if (!seen) return json({ error: "bad_request" }, 400);
  const { id } = await params;
  const a = await assistantById(id);
  if (!a || a.personId !== personId) return json({ error: "not_found" }, 404);
  return json({ marked: await markHerVisitsRead(a.id, seen, new Date()) });
});

export const OPTIONS = respuestaPrevia;
