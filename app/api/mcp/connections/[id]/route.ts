// REVOCAR UNA CONEXIÓN (la familia OAuth entera, o el token personal). Una
// ajena o inexistente contesta igual: 404.
import { auth } from "@/auth";
import { revokeConnection } from "@/lib/mcp/connections";
import { isSameOriginRequest } from "@/lib/mcp/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!isSameOriginRequest(req)) return json({ error: "cross_site" }, 403);
  const { id } = await params;
  return (await revokeConnection(userId, id)) ? json({ ok: true }) : json({ error: "not_found" }, 404);
}
