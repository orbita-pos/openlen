// POST /api/projects/[id]/len-watch/fix — «Fix with Len» (spec local 2026-10-30-len-watch, §5.3): Len
// starts on the standing incident. It answers at once; the check and the turn go on in the background.
import { standingIncident, whoMay } from "@/lib/len-watch/api";
import { startFix } from "@/lib/len-watch/orchestrate";
import { projectForWatch } from "@/lib/len-watch/owner";
import { claimFix, releaseFix } from "@/lib/len-watch/store";
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
  const incident = await standingIncident(id);
  if (!incident) return Response.json({ error: "no_incident" }, { status: 409 });
  if (!FIXABLE.includes(incident.status)) return Response.json({ error: "busy" }, { status: 409 });
  // Its fix changes tables and waits in its branch for «Traer el arreglo» (spec §5.5): fixing again would cut the
  // branch over it.
  if (incident.bringState === "pending") return Response.json({ error: "fix_pending" }, { status: 409 });
  const project = await projectForWatch(id);
  if (!project?.url) return Response.json({ error: "no_incident" }, { status: 409 });
  // Taken in one statement before answering: `startFix` looks at the page for seconds before it writes «fixing»,
  // and a second click in between started a second fix (a real incident, 31/10).
  if (!(await claimFix(incident.id, FIXABLE))) return Response.json({ error: "busy" }, { status: 409 });
  // The turn is whoever pressed: an editor's counts against the members' monthly cap.
  void startFix(incident, project, undefined, { actorId: who.userId }).catch(async (err: unknown) => {
    console.warn("[len-watch] the fix couldn't start", err);
    await releaseFix(incident.id, incident.status).catch(() => undefined);
  });
  return Response.json({ status: "fixing" }, { status: 202 });
});

export const OPTIONS = respuestaPrevia;
