// ONE-TAP DIRECTORY INSTALL + OAUTH START (spec local 2026-11-17-oauth-de-conectores-mcp, §6, §10.3, §10.5): the person taps
// «Conectar» on a `suggest_connectors` card; that tap writes the entry into `~/.len/mcp.json`, approves its fingerprint,
// and starts the OAuth sign-in — only for a person the directory offers the entry to. The answer names the server the
// entry got (`google-calendar-2` when the name was taken), so the page can match the way back.
import { installAndStartFromDirectory } from "@/lib/mcp-connectors/directory";
import { rememberNewIssuer } from "@/lib/mcp-connectors/oauth/flow";
import { oauthEnabled } from "@/lib/mcp-connectors/oauth/enabled";
import { realLenFileDeps, realOAuthDeps, realTurnDeps } from "@/lib/mcp-connectors/real";
import { markNeedsAuth, readMcpConfig, readServerStates, writeMcpConfig } from "@/lib/mcp-connectors/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { startedFromOf } from "@/lib/movil/started-from";
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
  const turnDeps = realTurnDeps();
  const r = await installAndStartFromDirectory(personId, id, {
    ...realOAuthDeps(),
    readConfig: readMcpConfig,
    writeConfig: writeMcpConfig,
    installedServerNames: lenDeps.installedServerNames,
    personEmail: async (p) => (await turnDeps.personEmail?.(p)) ?? null,
  }, { startedFrom: startedFromOf(req) });
  if (r.ok) return json({ server: r.server, authorizationUrl: r.authorizationUrl }, 200);
  // The sign-in is somewhere else now (spec §10.2): stored, so the server's next card names it.
  if ("issuerHost" in r) {
    await rememberNewIssuer(personId, r.server, r.issuer, { readStates: readServerStates, markNeedsAuth }).catch(() => {});
    return json({ error: r.error, server: r.server, issuerHost: r.issuerHost }, r.status);
  }
  return json({ error: r.error, ...(r.detail ? { detail: r.detail } : {}) }, r.status);
});

export const OPTIONS = respuestaPrevia;
