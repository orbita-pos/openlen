// GET /api/assistants/[id]/ab-decisions — pending A/B decision cards across all
// projects served by this assistant (Web + Mobile via `paraLaApp`).
import { abTestingEnabled } from "@/lib/ab/enabled";
import { pendingExperimentViewsForProjects } from "@/lib/ab/store";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { projectsOfAssistant } from "@/lib/assistants/projects";
import { assistantById } from "@/lib/assistants/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { accesoAlProyecto, puede } from "@/lib/projects/acceso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET = paraLaApp(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!assistantsEnabled() || !abTestingEnabled()) {
    return json({ decisions: [] }, 200);
  }

  const { id } = await params;
  const assistant = await assistantById(id);
  if (!assistant || assistant.personId !== userId) {
    return json({ error: "not_found" }, 404);
  }

  // Her projects were assigned once; the person's access to each is asked NOW (review item 28): a project they were removed
  // from, or can only read, shows no test cards — they carry the visitors' numbers and a decision only an editor takes.
  const served = await projectsOfAssistant(assistant.id);
  const allowed = await Promise.all(
    served.map(async (p) => {
      const acceso = await accesoAlProyecto(p.projectId, userId).catch(() => null);
      return acceso && puede(acceso.rol, "editar") ? p.projectId : null;
    }),
  );
  const projectIds = allowed.filter((id): id is string => id !== null);
  const decisions = await pendingExperimentViewsForProjects(projectIds);
  return json({ decisions }, 200);
});

export const OPTIONS = respuestaPrevia;
