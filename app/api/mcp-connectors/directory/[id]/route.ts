// ONE-TAP DIRECTORY INSTALL + OAUTH START (spec local 2026-11-17-oauth-de-conectores-mcp, §6, §10.5): the person taps
// «Conectar» on a `suggest_connectors` card; that tap writes the entry into `~/.len/mcp.json`, approves its fingerprint,
// and starts the OAuth sign-in.
import { installAndStartFromDirectory } from "@/lib/mcp-connectors/directory";
import { oauthEnabled } from "@/lib/mcp-connectors/oauth/enabled";
import { realLenFileDeps, realOAuthDeps } from "@/lib/mcp-connectors/real";
import { readMcpConfig, writeMcpConfig } from "@/lib/mcp-connectors/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const POST = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const personId = await usuarioDeLaPeticion(req);
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!oauthEnabled()) return json({ error: "off" }, 404);
  const { id } = await params;
  const lenDeps = realLenFileDeps();
  const r = await installAndStartFromDirectory(personId, id, {
    ...realOAuthDeps(),
    readConfig: readMcpConfig,
    writeConfig: writeMcpConfig,
    installedServerNames: lenDeps.installedServerNames,
  });
  if (r.ok) return json({ server: r.server, authorizationUrl: r.authorizationUrl }, 200);
  return json({ error: r.error, ...(r.detail ? { detail: r.detail } : {}) }, r.status);
});

export const OPTIONS = respuestaPrevia;
