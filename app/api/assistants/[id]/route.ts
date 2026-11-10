// ONE OF THE PERSON'S OWN ASSISTANTS (spec local 2026-11-06-asistente-propio, §4.5): read it, or delete it with its
// conversation. Someone else's is a 404, as if it didn't exist; with assistants off (OPENLEN_ASSISTANT=0) the whole
// surface answers `assistants_off`, like POST /api/assistants.
import { auth } from "@/auth";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { siteLocaleOf } from "@/lib/assistants/names";
import { assistantById, deleteAssistant, renameAssistant, setMorningSummary } from "@/lib/assistants/store";
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
  const body = (await req.json().catch(() => null)) as { onPage?: unknown; name?: unknown; morningSummary?: unknown; locale?: unknown } | null;
  const onPage = typeof body?.onPage === "boolean" ? body.onPage : undefined;
  const name = typeof body?.name === "string" ? body.name : undefined;
  const morningSummary = typeof body?.morningSummary === "boolean" ? body.morningSummary : undefined;
  if (onPage === undefined && name === undefined && morningSummary === undefined) return json({ error: "bad_request" }, 400);
  const a = await assistantById(id);
  if (!a || a.personId !== personId) return json({ error: "not_found" }, 404);
  const out: Record<string, unknown> = {};
  // Phase 4D (spec §6.8): renaming her moves her address; the old one redirects.
  if (name !== undefined) {
    const renamed = await renameAssistant(a.id, personId, name);
    if (!renamed.ok) return json({ error: renamed.error }, renamed.error === "name_taken" ? 409 : renamed.error === "invalid" ? 400 : 404);
    Object.assign(out, { name: renamed.name, slug: renamed.slug });
  }
  if (onPage !== undefined) {
    if (!(await setOnPage(a.homeProjectId, a.id, onPage))) return json({ error: "not_found" }, 404);
    Object.assign(out, { onPage, needsPublish: onPage });
  }
  // The morning summary (phase 4D, spec §6.9), in the language of the page that turned it on.
  if (morningSummary !== undefined) {
    if (!(await setMorningSummary(a.id, personId, morningSummary, siteLocaleOf(body?.locale)))) return json({ error: "not_found" }, 404);
    Object.assign(out, { morningSummary });
  }
  return json(out);
}
