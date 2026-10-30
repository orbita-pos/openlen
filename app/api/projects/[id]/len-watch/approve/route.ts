// POST /api/projects/[id]/len-watch/approve — Approve (spec local 2026-10-30-len-watch, §5.7): publishes
// Len's fix through the same gates as the publish route and answers what they answered — a 428 included,
// which the client turns into the usual publish review.
import { whoMay } from "@/lib/len-watch/api";
import { approveFix } from "@/lib/len-watch/orchestrate";
import { projectForWatch } from "@/lib/len-watch/owner";
import { activeIncident } from "@/lib/len-watch/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const { id } = await params;
  const who = await whoMay(req, id, "editar");
  if (who instanceof Response) return who;
  const incident = await activeIncident(id);
  const project = incident ? await projectForWatch(id) : null;
  if (!incident || !project?.url) return Response.json({ error: "no_incident" }, { status: 409 });
  const r = await approveFix(incident, project);
  return Response.json(r.body, { status: r.status });
});

export const OPTIONS = respuestaPrevia;
