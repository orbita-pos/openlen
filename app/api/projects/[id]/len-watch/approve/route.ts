// POST /api/projects/[id]/len-watch/approve — Approve (spec local 2026-10-30-len-watch, §5.7): publishes
// Len's fix through the same gates as the publish route and answers what they answered — a 428 included,
// which the client turns into the usual publish review.
import { standingIncident, whoMay } from "@/lib/len-watch/api";
import { approveFix } from "@/lib/len-watch/orchestrate";
import { projectForWatch } from "@/lib/len-watch/owner";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const { id } = await params;
  const who = await whoMay(req, id, "editar");
  if (who instanceof Response) return who;
  const incident = await standingIncident(id);
  const project = incident ? await projectForWatch(id) : null;
  if (!incident || !project?.url) return Response.json({ error: "no_incident" }, { status: 409 });
  // `confirmChanged`: the person saw that the draft moved after Len's fix and publishes anyway.
  // `acceptSecurityFingerprint`: «Publicar igual» over what the security review found in the fix.
  const body = (await req.json().catch(() => null)) as { confirmChanged?: unknown; acceptSecurityFingerprint?: unknown } | null;
  const accept = typeof body?.acceptSecurityFingerprint === "string" && /^[0-9a-f]{64}$/.test(body.acceptSecurityFingerprint) ? body.acceptSecurityFingerprint : null;
  const r = await approveFix(incident, project, undefined, { actorId: who.userId, confirmChanged: body?.confirmChanged === true, ...(accept ? { acceptSecurityFingerprint: accept } : {}) });
  return Response.json(r.body, { status: r.status });
});

export const OPTIONS = respuestaPrevia;
