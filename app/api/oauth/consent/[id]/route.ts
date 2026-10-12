// DECIDIR EL CONSENTIMIENTO: sólo con la sesión de la web.
import { auth } from "@/auth";
import { decideConsent } from "@/lib/mcp/oauth/consent";
import { isSameOriginRequest } from "@/lib/mcp/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const STATUS = { not_found: 404, expired: 410, already_decided: 409, project_not_allowed: 403 } as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!isSameOriginRequest(req)) return json({ error: "cross_site" }, 403);
  const body = (await req.json().catch(() => null)) as { decision?: unknown; scopes?: unknown; project_id?: unknown } | null;
  if (body?.decision !== "allow" && body?.decision !== "deny") return json({ error: "invalid_body" }, 400);
  const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s): s is string => typeof s === "string") : [];
  const projectId = typeof body.project_id === "string" && body.project_id ? body.project_id : null;
  const { id } = await params;
  const r = await decideConsent({ requestId: id, userId, approve: body.decision === "allow", scopes, projectId });
  return r.ok ? json({ redirect: r.redirect }) : json({ error: r.error }, STATUS[r.error]);
}
