// POST /api/projects/[id]/len-watch/fix — «Fix with Len» (spec local 2026-10-30-len-watch, §5.3): Len
// starts on the standing incident. It answers at once; the check and the turn go on in the background.
import { whoMay } from "@/lib/len-watch/api";
import { startFix } from "@/lib/len-watch/orchestrate";
import { projectForWatch } from "@/lib/len-watch/owner";
import { activeIncident } from "@/lib/len-watch/store";
import type { IncidentStatus } from "@/lib/len-watch/types";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where Len may be asked to start: the site is down and nobody is working on it. */
const FIXABLE: readonly IncidentStatus[] = ["open", "needs_owner", "fix_failed"];

export const POST = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const { id } = await params;
  const who = await whoMay(req, id, "editar");
  if (who instanceof Response) return who;
  const incident = await activeIncident(id);
  if (!incident) return Response.json({ error: "no_incident" }, { status: 409 });
  if (!FIXABLE.includes(incident.status)) return Response.json({ error: "busy" }, { status: 409 });
  const project = await projectForWatch(id);
  if (!project?.url) return Response.json({ error: "no_incident" }, { status: 409 });
  void startFix(incident, project).catch((err: unknown) => console.warn("[len-watch] the fix couldn't start", err));
  return Response.json({ status: "fixing" }, { status: 202 });
});

export const OPTIONS = respuestaPrevia;
