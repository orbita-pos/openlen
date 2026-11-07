// THE PERSON'S CONNECTORS (spec local 2026-11-06-conectores-mcp, §5.7): what the «Conectores» section of the Herramientas
// page reads. Never a header value or a key. Only the workspace's browser session.
import { auth } from "@/auth";
import { connectorsEnabled } from "@/lib/mcp-connectors/enabled";
import { listView } from "@/lib/mcp-connectors/manage";
import { realManageDeps } from "@/lib/mcp-connectors/real";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!connectorsEnabled()) return json({ available: false });
  return json({ available: true, ...(await listView(personId, realManageDeps())) });
}
