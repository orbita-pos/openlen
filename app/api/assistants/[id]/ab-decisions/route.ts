// GET /api/assistants/[id]/ab-decisions — pending A/B decision cards across all
// projects served by this assistant (Web + Mobile via `paraLaApp`).
import { abTestingEnabled } from "@/lib/ab/enabled";
import { pendingExperimentViewsForProjects } from "@/lib/ab/store";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { projectsOfAssistant } from "@/lib/assistants/projects";
import { assistantById } from "@/lib/assistants/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

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

  const served = await projectsOfAssistant(assistant.id);
  const projectIds = served.map((p) => p.projectId);
  const decisions = await pendingExperimentViewsForProjects(projectIds);
  return json({ decisions }, 200);
});

export const OPTIONS = respuestaPrevia;
