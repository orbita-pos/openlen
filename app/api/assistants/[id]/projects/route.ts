// HER PROJECTS (spec local 2026-11-06-asistente-propio, §4.5): the projects the person's own assistant serves — her home
// first — and connecting her to another of her person's own projects. Only her person, and only with projects they
// OWN (§6.12): a project where they are a member is not theirs to give her. Connecting brings what that project's
// assistant of today was taught into her memory (§6.4).
import { auth } from "@/auth";
import { AGENT_MEMORY_MAX } from "@/lib/agent/user-memory";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { mergeOldAssistantMemory } from "@/lib/assistants/knowledge";
import { connectProject, projectsOfAssistant, titlesOf } from "@/lib/assistants/projects";
import { assistantById, oldAssistantSettings, saveAssistantMemory } from "@/lib/assistants/store";
import { onPageState } from "@/lib/assistants/visitor/on-page";
import { accesoAlProyecto } from "@/lib/projects/acceso";
import { conAutorDeLaPeticion, quienDeLaSesion } from "@/lib/projects/autor-del-cambio";
import { publishedHost } from "@/lib/publish/base-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** Her person's assistant, or the response that refuses. */
async function hers(id: string): Promise<{ personId: string; assistant: NonNullable<Awaited<ReturnType<typeof assistantById>>> } | Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled()) return json({ error: "assistants_off" }, 404);
  const assistant = await assistantById(id);
  if (!assistant || assistant.personId !== personId) return json({ error: "not_found" }, 404);
  return { personId, assistant };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await hers((await params).id);
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

export const POST = conAutorDeLaPeticion(quienDeLaSesion, async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const found = await hers((await params).id);
  if (found instanceof Response) return found;
  const body = (await req.json().catch(() => null)) as { projectId?: unknown } | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId.slice(0, 100) : "";
  const acceso = projectId ? await accesoAlProyecto(projectId, found.personId) : null;
  if (!acceso) return json({ error: "not_found" }, 404);
  if (acceso.rol !== "dueno") return json({ error: "solo_dueno" }, 403);
  const done = await connectProject({ assistantId: found.assistant.id, projectId });
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
});
