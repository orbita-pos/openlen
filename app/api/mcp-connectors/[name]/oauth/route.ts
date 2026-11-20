// STARTING AND DROPPING AN OAUTH SIGN-IN FOR ONE CONNECTOR (spec local 2026-11-17-oauth-de-conectores-mcp, §5.4 steps 2
// and 5, §10.1, §10.6): POST accepts the web session or the phone's app key, discovers the authorization server, creates
// a one-use ten-minute `state` and hands back the authorization URL. DELETE revokes (RFC 7009, best-effort) and drops
// the stored connection, leaving the server in `needs-auth` `first`.
import { oauthEnabled } from "@/lib/mcp-connectors/oauth/enabled";
import { dropSignIn, startSignIn } from "@/lib/mcp-connectors/oauth/flow";
import { cleanScope } from "@/lib/mcp-connectors/oauth/remote-text";
import { realOAuthDeps } from "@/lib/mcp-connectors/real";
import { markNeedsAuth, readMcpConfig, readServerStates } from "@/lib/mcp-connectors/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const POST = paraLaApp(async (req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> => {
  const personId = await usuarioDeLaPeticion(req);
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!oauthEnabled()) return json({ error: "off" }, 404);
  const { name } = await params;
  const states = await readServerStates(personId).catch(() => []);
  const state = states.find((s) => s.serverName === name);
  // The scope is a server's own word, stored: it asks the provider for plain scope tokens only (remote-text.ts).
  const scope = state?.status === "needs-auth" && state.authReason === "scope" ? (cleanScope(state.authScope) ?? undefined) : undefined;
  const r = await startSignIn(
    personId,
    name,
    { ...realOAuthDeps(), readConfig: readMcpConfig },
    scope ? { scope } : {},
  );
  if (r.ok) return json({ authorizationUrl: r.authorizationUrl }, 200);
  const status = r.reason === "not_approved" ? 409 : r.reason === "no_client" ? 422 : 502;
  return json({ error: r.reason, detail: r.error }, status);
});

export const DELETE = paraLaApp(async (req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> => {
  const personId = await usuarioDeLaPeticion(req);
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!oauthEnabled()) return json({ error: "off" }, 404);
  const { name } = await params;
  const r = await dropSignIn(personId, name, { ...realOAuthDeps(), readConfig: readMcpConfig });
  // Only a connection that was there leaves the server waiting for a sign-in: dropping nothing changes nothing.
  if (r.dropped) await markNeedsAuth(personId, name, "first", r.issuer, null).catch(() => {});
  return json({ ok: true }, 200);
});

export const OPTIONS = respuestaPrevia;
