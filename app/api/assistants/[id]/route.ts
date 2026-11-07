// ONE OF THE PERSON'S OWN ASSISTANTS (spec local 2026-11-06-asistente-propio, §4.5): read it, or delete it with its
// conversation. Someone else's is a 404, as if it didn't exist.
import { auth } from "@/auth";
import { assistantById, deleteAssistant } from "@/lib/assistants/store";
import { assistantView } from "@/lib/assistants/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const a = await assistantById(id);
  if (!a || a.personId !== personId) return json({ error: "not_found" }, 404);
  return json(assistantView(a));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!(await deleteAssistant(personId, id))) return json({ error: "not_found" }, 404);
  return new Response(null, { status: 204 });
}
