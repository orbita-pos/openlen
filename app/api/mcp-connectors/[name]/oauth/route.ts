// STARTING AND DROPPING AN OAUTH SIGN-IN FOR ONE CONNECTOR (spec local 2026-11-17-oauth-de-conectores-mcp, §5.4 steps 2
// and 5, §10.1, §10.6): POST accepts the web session or the phone's app key, discovers the authorization server, creates
// a one-use ten-minute `state` and hands back the authorization URL. DELETE revokes (RFC 7009, best-effort) and drops
// the stored connection, leaving the server in `needs-auth` `first` — only with the web session: «Desconectar» is the
// Herramientas page's, and the phone never calls it (final review M5), so it takes no app key and carries no CORS.
//
// The sign-in host the person was shown (§10.2): the card sends the host it named (`{ issuerHost }`, null when it named
// none); without a body — the Herramientas page — it is the one the stored state names. If the discovery now names
// another, nothing starts: 409 `issuer_changed` with the new host, which is stored so the next card names it.
//
// The flow records where it was started (final review F5): the phone's key ("phone") or the web session ("web"). The way
// back trusts a web flow only in a browser signed in as its person, and holds a phone flow's tokens for the person's yes.
import { auth } from "@/auth";
import { entryFingerprint, parseMcpConfig } from "@/lib/mcp-connectors/config";
import { oauthEnabled } from "@/lib/mcp-connectors/oauth/enabled";
import { issuerHostOf } from "@/lib/mcp-connectors/approval";
import { dropSignIn, rememberNewIssuer, startSignIn } from "@/lib/mcp-connectors/oauth/flow";
import { cleanScope } from "@/lib/mcp-connectors/oauth/remote-text";
import { realOAuthDeps } from "@/lib/mcp-connectors/real";
import { markNeedsAuth, readMcpConfig, readServerStates, type ServerState, type StoredConfig } from "@/lib/mcp-connectors/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { startedFromOf } from "@/lib/movil/started-from";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * The step-up scope a server asked for (§10.6), as plain scope tokens — only if it was asked of the entry that is in the
 * file NOW and is approved: the state keeps the fingerprint of the entry it was written for, and once the entry is edited
 * (or the approval is another's) that scope is the word of a version nobody approved.
 */
function stepUpScope(state: ServerState | undefined, name: string, stored: StoredConfig): string | undefined {
  if (state?.status !== "needs-auth" || state.authReason !== "scope") return undefined;
  const parsed = parseMcpConfig(stored.text, { reservedServerNames: new Set() });
  const entry = parsed.ok ? parsed.config.servers[name] : undefined;
  if (!entry) return undefined;
  const current = entryFingerprint(entry);
  if (stored.approved[name] !== current || state.fingerprint !== current) return undefined;
  return cleanScope(state.authScope) ?? undefined;
}

/** The sign-in host the stored state names, if it was found for the entry approved now; undefined otherwise (nothing to
 *  check, as when it names none). */
function storedIssuerHost(state: ServerState | undefined, name: string, stored: StoredConfig): string | undefined {
  if (state?.status !== "needs-auth") return undefined;
  const parsed = parseMcpConfig(stored.text, { reservedServerNames: new Set() });
  const entry = parsed.ok ? parsed.config.servers[name] : undefined;
  if (!entry) return undefined;
  const current = entryFingerprint(entry);
  if (stored.approved[name] !== current || state.fingerprint !== current) return undefined;
  return issuerHostOf(entry, state.authIssuer) ?? undefined;
}

export const POST = paraLaApp(async (req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> => {
  const personId = await usuarioDeLaPeticion(req);
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!oauthEnabled()) return json({ error: "off" }, 404);
  const { name } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const states = await readServerStates(personId).catch(() => []);
  const state = states.find((s) => s.serverName === name);
  // The scope is a server's own word, stored: it asks the provider for plain scope tokens only (remote-text.ts), and only
  // when it was asked of the entry that is approved now.
  const stored = state?.status === "needs-auth" ? await readMcpConfig(personId).catch(() => null) : null;
  const scope = stored ? stepUpScope(state, name, stored) : undefined;
  // What the card showed is what the person agreed to; the stored state stands in when no card sent it.
  const named = body !== null && typeof body === "object" && "issuerHost" in body ? body.issuerHost : undefined;
  const expectedIssuerHost = typeof named === "string" || named === null ? named : stored ? storedIssuerHost(state, name, stored) : undefined;
  const r = await startSignIn(
    personId,
    name,
    { ...realOAuthDeps(), readConfig: readMcpConfig },
    { ...(scope ? { scope } : {}), ...(expectedIssuerHost !== undefined ? { expectedIssuerHost } : {}), startedFrom: startedFromOf(req) },
  );
  if (r.ok) return json({ authorizationUrl: r.authorizationUrl }, 200);
  if (r.reason === "issuer_changed") {
    await rememberNewIssuer(personId, name, r.issuer, { readStates: readServerStates, markNeedsAuth }).catch(() => {});
    return json({ error: r.reason, issuerHost: r.issuerHost }, 409);
  }
  const status = r.reason === "not_approved" ? 409 : r.reason === "no_client" ? 422 : 502;
  return json({ error: r.reason, detail: r.error }, status);
});

export async function DELETE(_req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!oauthEnabled()) return json({ error: "off" }, 404);
  const { name } = await params;
  const r = await dropSignIn(personId, name, { ...realOAuthDeps(), readConfig: readMcpConfig });
  // Only a connection that was there leaves the server waiting for a sign-in: dropping nothing changes nothing.
  if (r.dropped) await markNeedsAuth(personId, name, "first", r.issuer, null).catch(() => {});
  return json({ ok: true }, 200);
}

export const OPTIONS = respuestaPrevia;
