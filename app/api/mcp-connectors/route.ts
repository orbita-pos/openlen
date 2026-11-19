// THE PERSON'S CONNECTORS (spec local 2026-11-06-conectores-mcp, §5.7): what the «Conectores» section of the Herramientas
// page reads. Never a header value or a key. Only the workspace's browser session.
import { connectorsEnabled } from "@/lib/mcp-connectors/enabled";
import { listView } from "@/lib/mcp-connectors/manage";
import { realManageDeps } from "@/lib/mcp-connectors/real";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const GET = paraLaApp(async (req: Request): Promise<Response> => {
  const personId = await usuarioDeLaPeticion(req);
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!connectorsEnabled()) return json({ available: false });
  return json({ available: true, ...(await listView(personId, realManageDeps())) });
});

export const OPTIONS = respuestaPrevia;
