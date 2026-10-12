// DECIDIR UNA APROBACIÓN DEL MCP: sólo con la sesión de la web (la cookie de
// openlen.com), nunca con un token del MCP — así un agente no se aprueba solo.
import { auth } from "@/auth";
import { decideApproval, getApprovalForUser } from "@/lib/mcp/approvals";
import { isSameOriginRequest } from "@/lib/mcp/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!isSameOriginRequest(req)) return json({ error: "cross_site" }, 403);
  const body = (await req.json().catch(() => null)) as { decision?: unknown } | null;
  const decision = body?.decision;
  if (decision !== "approve" && decision !== "deny") return json({ error: "invalid_body" }, 400);
  const { id } = await params;
  const approval = await getApprovalForUser(id, userId);
  if (!approval) return json({ error: "not_found" }, 404);
  const ok = await decideApproval(id, userId, decision);
  return ok ? json({ ok: true }) : json({ error: "already_decided_or_expired" }, 409);
}
