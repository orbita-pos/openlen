// ONE OF THE PERSON'S OWN ASSISTANTS (spec local 2026-11-06-asistente-propio, §4.5): read it, or delete it with its
// conversation. Someone else's is a 404, as if it didn't exist; with assistants off (OPENLEN_ASSISTANT=0) the whole
// surface answers `assistants_off`, like POST /api/assistants.
import { auth } from "@/auth";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { assistantById, deleteAssistant } from "@/lib/assistants/store";
import { setOnPage } from "@/lib/assistants/visitor/store";
import { assistantView } from "@/lib/assistants/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const { id } = await params;
  const a = await assistantById(id);
  if (!a || a.personId !== personId) return json({ error: "not_found" }, 404);
  return json(assistantView(a));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const { id } = await params;
  if (!(await deleteAssistant(personId, id))) return json({ error: "not_found" }, 404);
  return new Response(null, { status: 204 });
}

/** «En mi página» (spec §4.4.5; phase 2A): `{ onPage }`. Off is immediate (the bubble asks on every visit); on shows
 *  after the next publish, which bakes her bubble and switches today's assistant off in the same go (§6.4) — until
 *  then the page keeps the bubble it has. Only its person. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { onPage?: unknown } | null;
  if (typeof body?.onPage !== "boolean") return json({ error: "bad_request" }, 400);
  const a = await assistantById(id);
  if (!a || a.personId !== personId) return json({ error: "not_found" }, 404);
  if (!(await setOnPage(a.homeProjectId, a.id, body.onPage))) return json({ error: "not_found" }, 404);
  return json({ onPage: body.onPage, needsPublish: body.onPage });
}
