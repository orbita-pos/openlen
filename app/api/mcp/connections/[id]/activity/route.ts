// LO QUE HIZO UNA CONEXIÓN (de mcpAudit: herramienta, proyecto, resultado; nunca argumentos).
import { auth } from "@/auth";
import { connectionActivity } from "@/lib/mcp/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  return json({ activity: await connectionActivity(userId, id) });
}
