// LAS CONEXIONES DE LA PERSONA (la página «Aplicaciones conectadas»), de 20 en
// 20 (`?cursor=`). Sólo con la sesión de la web.
import { auth } from "@/auth";
import { listConnections } from "@/lib/mcp/connections";
import { pageConnections } from "@/lib/mcp/connections-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(req: Request): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { items, nextCursor } = pageConnections(await listConnections(userId), new URL(req.url).searchParams.get("cursor"));
  return json({ connections: items, next_cursor: nextCursor });
}
