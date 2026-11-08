// THE PERSON'S OWN ASSISTANT (spec local 2026-11-06-asistente-propio, §4.4): the creator's «Listo» creates it (POST),
// and the person's own are listed for their place and the start rail (GET). Only a project's owner creates one there;
// it is the person's, so their session decides, never a body field.
import { auth } from "@/auth";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { checkAssistantInput } from "@/lib/assistants/names";
import { memoryFromOldAssistant } from "@/lib/assistants/knowledge";
import { assistantsOf, createAssistant, oldAssistantSettings } from "@/lib/assistants/store";
import { assistantView } from "@/lib/assistants/view";
import { accesoAlProyecto } from "@/lib/projects/acceso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(req: Request): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const acceso = projectId ? await accesoAlProyecto(projectId, personId) : null;
  if (!acceso) return json({ error: "not_found" }, 404);
  if (acceso.rol !== "dueno") return json({ error: "solo_dueno" }, 403);
  const input = checkAssistantInput(body ?? {});
  if (!input.ok) return json({ field: input.field }, 400);
  // What today's assistant of this project was taught starts her memory (spec §6.4; phase 2A). Fail-soft.
  const memory = memoryFromOldAssistant(await oldAssistantSettings(projectId).catch(() => undefined));
  const created = await createAssistant({ personId, projectId, input: input.value, memory });
  if (!created.ok) return json({ error: created.code }, 409);
  return json({ id: created.assistant.id, slug: created.assistant.slug }, 201);
}

export async function GET(): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ assistants: [] });
  return json({ assistants: (await assistantsOf(personId)).map(assistantView) });
}
