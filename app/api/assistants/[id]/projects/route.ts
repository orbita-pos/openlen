// HER PROJECTS (spec local 2026-11-06-asistente-propio, §4.5): the projects the person's own assistant serves — her home
// first — and connecting her to another of her person's own projects. Only her person, and only with projects they
// OWN (§6.12): a project where they are a member is not theirs to give her. Connecting brings what that project's
// assistant of today was taught into her memory (§6.4).
import { auth } from "@/auth";
import { AGENT_MEMORY_MAX } from "@/lib/agent/user-memory";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { mergeOldAssistantMemory } from "@/lib/assistants/knowledge";
import { connectProject, projectsOfAssistant, replaceOnProject, titlesOf } from "@/lib/assistants/projects";
import { assistantById, assistantOfProject, oldAssistantSettings, saveAssistantMemory } from "@/lib/assistants/store";
import { agentsEnabled } from "@/lib/space/enabled";
import { ensureSpace } from "@/lib/space/store";
import { onPageState } from "@/lib/assistants/visitor/on-page";
import { accesoAlProyecto } from "@/lib/projects/acceso";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { autorDelCambio, conAutorDeLaPeticion } from "@/lib/projects/autor-del-cambio";
import { publishedHost } from "@/lib/publish/base-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** Her person's assistant, or the response that refuses. Who asks is resolved by the caller: the GET only with the
 *  session, the POST with the session or the phone's key. */
async function hers(personId: string | null | undefined, id: string): Promise<{ personId: string; assistant: NonNullable<Awaited<ReturnType<typeof assistantById>>> } | Response> {
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const assistant = await assistantById(id);
  if (!assistant || assistant.personId !== personId) return json({ error: "not_found" }, 404);
  return { personId, assistant };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await hers((await auth())?.user?.id, (await params).id);
  if (found instanceof Response) return found;
  const projects = await projectsOfAssistant(found.assistant.id);
  return json({
    projects: projects.map((p) => {
      const state = onPageState(p.onPage ? p : null, false);
      return {
        projectId: p.projectId,
        title: p.title,
        address: p.subdomain ? publishedHost(p.subdomain) : null,
        isHome: p.isHome,
        onPage: state.onPage,
        needsPublish: state.needsPublish,
        nothingToKnow: state.nothingToKnow,
        // Published since she serves it: she knows what it published (final review I2).
        knowsIt: Boolean(p.knowledgeAt),
      };
    }),
  });
}

/** With the session or the phone's key: «Que Lucía lo atienda» on the phone sends `onPage: false` — from there she
 *  takes a project to pass its requests to Len, not to answer its visitors (Jesús 16/11, spec local
 *  2026-11-16-movil-es-tu-asistente, §5.6). Without it, on — the web's rule. */
export const POST = paraLaApp(conAutorDeLaPeticion(
  (req: Request, _ctx: { params: Promise<{ id: string }> }) => usuarioDeLaPeticion(req),
  async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
    // Who asks was resolved once, by the author wrapper: the handler reads it there instead of asking again.
    const found = await hers(autorDelCambio(), (await params).id);
    if (found instanceof Response) return found;
    const body = (await req.json().catch(() => null)) as { projectId?: unknown; onPage?: unknown; replace?: unknown } | null;
    const projectId = typeof body?.projectId === "string" ? body.projectId.slice(0, 100) : "";
    const acceso = projectId ? await accesoAlProyecto(projectId, found.personId) : null;
    if (!acceso) return json({ error: "not_found" }, 404);
    if (acceso.rol !== "dueno") return json({ error: "solo_dueno" }, 403);
    // «Atender una página» (spec local 2026-11-19-agentes-para-todos, §6.7): the person chose to put her there in place of
    // the one it has — which, if it lived on that page, moves to their space. Only with agents on: the space is theirs.
    const done =
      body?.replace === true && agentsEnabled()
        ? await replaceOnProject({ assistantId: found.assistant.id, projectId, onPage: body.onPage !== false, spaceId: await ensureSpace(found.personId) })
        : await connectProject({ assistantId: found.assistant.id, projectId, ...(body?.onPage === false ? { onPage: false } : {}) });
    if (done === "space_not_a_page") return json({ error: done }, 400);
    if (done === "project_has_assistant") {
      // Who has it, for the person to choose whether to put her there instead.
      const current = await assistantOfProject(projectId).catch(() => null);
      return json({ error: done, ...(current ? { current: { name: current.name, slug: current.slug } } : {}) }, 409);
    }
    if (done !== "connected") return json({ error: done }, 409);
    // What that project's assistant of today was taught joins her memory. Fail-soft: she is connected either way.
    try {
      const old = await oldAssistantSettings(projectId);
      const title = (await titlesOf([projectId])).get(projectId) ?? projectId;
      const memory = mergeOldAssistantMemory(found.assistant.memory, old, title, AGENT_MEMORY_MAX);
      if (memory !== found.assistant.memory) await saveAssistantMemory(found.assistant.id, memory);
    } catch (err) {
      console.warn("[assistants] what the project's old assistant knew wasn't brought into her memory", err);
    }
    return json({ projectId }, 201);
  },
));

export const OPTIONS = respuestaPrevia;
