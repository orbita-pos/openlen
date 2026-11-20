// THE PERSON'S OWN ASSISTANT (spec local 2026-11-06-asistente-propio, §4.4): the creator's «Listo» creates it (POST),
// and the person's own are listed for their place and the start rail (GET). Only a project's owner creates one there;
// it is the person's, so their session decides, never a body field.
import { agentTypeProblem } from "@/lib/assistants/agent-file";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { checkAssistantInput, siteLocaleOf, type AssistantInput } from "@/lib/assistants/names";
import { memoryFromOldAssistant } from "@/lib/assistants/knowledge";
import { projectIdsOf } from "@/lib/assistants/projects";
import { assistantsOf, createAssistant, oldAssistantSettings } from "@/lib/assistants/store";
import { assistantView } from "@/lib/assistants/view";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { accesoAlProyecto } from "@/lib/projects/acceso";
import { agentsEnabled } from "@/lib/space/enabled";
import { ensureSpace } from "@/lib/space/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** With the session or the phone's key: the phone's welcome creates her too, with her bubble off (spec local
 *  2026-11-16-movil-es-tu-asistente, §5.1, §5.6). Without `onPage: false`, on — the web's rule. */
export const POST = paraLaApp(async (req: Request): Promise<Response> => {
  const personId = await usuarioDeLaPeticion(req);
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  // AGENTS FOR EVERYONE (spec local 2026-11-19-agentes-para-todos, §6.3): a page is optional — from the home there is
  // none. With OPENLEN_AGENTS=0, today's rule: a page is required and it is her home.
  const agents = agentsEnabled();
  const acceso = projectId ? await accesoAlProyecto(projectId, personId) : null;
  if (projectId || !agents) {
    if (!acceso) return json({ error: "not_found" }, 404);
    if (acceso.rol !== "dueno") return json({ error: "solo_dueno" }, 403);
  }
  const input = checkAssistantInput(body ?? {});
  if (!input.ok) return json({ field: input.field }, 400);
  // The morning summary, only when the creator ticked it, in the page's language (phase 4D, spec §6.9).
  const summary = body?.morningSummary === true ? { morningSummary: true, locale: siteLocaleOf(body.locale) } : {};
  // What today's assistant of this project was taught starts her memory (spec §6.4; phase 2A). Fail-soft.
  const memory = projectId ? { memory: memoryFromOldAssistant(await oldAssistantSettings(projectId).catch(() => undefined)) } : {};
  const created = agents
    ? await createInTheSpace(personId, projectId, body, input.value, memory, summary)
    : await createAssistant({ personId, projectId, input: input.value, ...memory, ...summary, ...(body?.onPage === false ? { onPage: false } : {}) });
  if (created instanceof Response) return created;
  if (!created.ok) return json({ error: created.code }, 409);
  return json({ id: created.assistant.id, slug: created.assistant.slug }, 201);
});

/** Its home is the person's space; the page it was asked for, if any, it attends — on, unless born from the phone. */
async function createInTheSpace(
  personId: string,
  projectId: string,
  body: Record<string, unknown> | null,
  input: AssistantInput,
  memory: { memory?: string },
  summary: { morningSummary?: boolean; locale?: string },
) {
  const space = await ensureSpace(personId);
  if (projectId === space) return json({ error: "space_not_a_page" }, 400);
  const agentType = typeof body?.agentType === "string" && body.agentType ? body.agentType : null;
  if (agentType) {
    const problem = await agentTypeProblem(personId, agentType);
    if (problem) return json({ error: `agent_${problem}` }, 400);
  }
  const served = projectId ? { projectId, onPage: body?.onPage !== false } : null;
  // An agent with a file answers the page's visitors from its note for them, never from its memory: what the page's old
  // assistant knew starts that note instead.
  const known = agentType ? (memory.memory ? { customerNote: memory.memory } : {}) : memory;
  return createAssistant({ personId, homeProjectId: space, served, input, ...known, ...summary, agentType });
}

/** Hers, with the session or the phone's key (phase 5: her tab in Len móvil lists them). */
export const GET = paraLaApp(async (req: Request): Promise<Response> => {
  const personId = await usuarioDeLaPeticion(req);
  if (!personId) return json({ error: "unauthorized" }, 401);
  // `enabled` (spec local 2026-11-16-movil-es-tu-asistente, §5.1): the phone tells «off» from «none yet».
  if (!assistantsEnabled()) return json({ assistants: [], enabled: false });
  const mine = await assistantsOf(personId);
  // Each with the projects she serves (phase 4): a card in a project knows whether that project has her.
  const served = await projectIdsOf(mine.map((a) => a.id));
  return json({ enabled: true, assistants: mine.map((a) => ({ ...assistantView(a), projectIds: served.get(a.id) ?? [a.homeProjectId] })) });
});

export const OPTIONS = respuestaPrevia;
