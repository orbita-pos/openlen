// LAS CONEXIONES DE LA PERSONA (la página «Aplicaciones conectadas»). Sólo con la sesión de la web.
import { auth } from "@/auth";
import { listConnections } from "@/lib/mcp/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  return json({ connections: await listConnections(userId) });
}
