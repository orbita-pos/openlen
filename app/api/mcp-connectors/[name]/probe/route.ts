// «PROBAR» (spec local 2026-11-06-conectores-mcp, §5.7): DeepSeek's probe — connect, list the tools, close, save nothing.
// Errors come redacted of every key the probe sent. Only the workspace's browser session.
import { auth } from "@/auth";
import { connectorsEnabled } from "@/lib/mcp-connectors/enabled";
import { probeServer } from "@/lib/mcp-connectors/mount";
import { realMountDeps } from "@/lib/mcp-connectors/real";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(_req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!connectorsEnabled()) return json({ error: "off" }, 404);
  const { name } = await params;
  return json(await probeServer(personId, name, realMountDeps()));
}
