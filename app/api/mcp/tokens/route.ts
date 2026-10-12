// CREAR UN TOKEN PERSONAL desde «Aplicaciones conectadas». El secreto sale en
// esta respuesta y en ninguna otra. 20 al día por persona.
import { auth } from "@/auth";
import { checkAndConsume } from "@/lib/limits";
import { createPersonalToken } from "@/lib/mcp/connections";
import { isSameOriginRequest } from "@/lib/mcp/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const STATUS = { invalid_name: 400, invalid_expiry: 400, project_not_allowed: 403 } as const;

export async function POST(req: Request): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!isSameOriginRequest(req)) return json({ error: "cross_site" }, 403);
  const gate = await checkAndConsume(`user:${userId}:mcp_token`, [{ windowMs: 24 * 60 * 60_000, max: 20, label: "daily" }]).catch(() => ({
    ok: false,
  }));
  if (!gate.ok) return json({ error: "too_many_requests" }, 429);
  const b = (await req.json().catch(() => null)) as { name?: unknown; scopes?: unknown; project_id?: unknown; expires_in_days?: unknown } | null;
  const r = await createPersonalToken(userId, {
    name: typeof b?.name === "string" ? b.name : "",
    scopes: Array.isArray(b?.scopes) ? b.scopes.filter((s): s is string => typeof s === "string") : [],
    projectId: typeof b?.project_id === "string" && b.project_id ? b.project_id : null,
    expiresInDays: typeof b?.expires_in_days === "number" ? b.expires_in_days : null,
  });
  return r.ok ? json({ id: r.id, token: r.secret }, 201) : json({ error: r.error }, STATUS[r.error]);
}
