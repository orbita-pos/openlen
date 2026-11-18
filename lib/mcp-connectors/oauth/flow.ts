// SIGNING IN TO AN MCP SERVER, SERVER-SIDE (spec local 2026-11-17-oauth-de-conectores-mcp, §5.2, §5.4 steps 2–3, §10.1,
// §10.2, §10.6). The SDK's `auth()` does the OAuth — discovery (RFC 9728/8414), the client (§5.2's order), PKCE, the
// resource indicator, RFC 9207's `iss` — with a provider that never redirects anyone: `startSignIn` hands back the
// authorization URL for the web to open, and `finishSignIn` exchanges the code the provider sends back.
//
// The way back trusts the `state` (§10.1): 32 random bytes, one use, ten minutes, bound to the person, the server, the
// entry's fingerprint and the issuer (store.ts). It is spent first and checked after, so whatever goes wrong the same
// `state` never works twice; a session person that isn't the flow's is answered as if the state were unknown.
//
// OpenLen discovers the authorization server itself, once, before `auth()` and hands the SDK that result as its
// discovery state: the issuer the start names is the one the flow is bound to, and at the exchange an issuer that is no
// longer the flow's is refused (`issuer_changed`) before a code is sent anywhere.
//
// Nothing here logs or returns a token, code, verifier or secret; errors from remote servers are redacted and cut short.
import { auth, AuthorizationServerMismatchError, computeScopeUnion, type OAuthClientProvider, type OAuthDiscoveryState, type StoredOAuthClientInformation } from "@modelcontextprotocol/client";

import { entryFingerprint, parseMcpConfig, type McpServerEntry } from "../config";
import type { ServerState, StoredConfig } from "../store";
import { credentialRefsOf, makeRedactor, resolveEntry } from "../templates";
import { callbackUrl, clientMetadata, clientMetadataUrl, isClientRefusal } from "./clients";
import { discoverAuthServer, entryClient, shortError, storableClient, type OAuthDeps } from "./provider";

export type StartDeps = OAuthDeps & { readConfig(personId: string): Promise<StoredConfig> };
export type FinishDeps = StartDeps & { mount(personId: string, name: string): Promise<ServerState | null> };

export type StartResult = { ok: true; authorizationUrl: string } | { ok: false; reason: "not_approved" | "no_client" | "unreachable"; error: string };
export type FinishResult =
  | { ok: true; server: string }
  | { ok: false; reason: "expired" | "used" | "unknown" | "denied" | "changed" | "issuer_changed" | "exchange_failed"; server?: string };

class AuthorizationEndpointNotHttps extends Error {
  constructor() {
    super("the authorization endpoint is not https");
  }
}

/** The entry as the person approved it, or null (removed, edited since, or never approved). */
function approvedEntry(stored: StoredConfig, serverName: string): { entry: McpServerEntry; fingerprint: string } | null {
  const parsed = parseMcpConfig(stored.text, { reservedServerNames: new Set() });
  const entry = parsed.ok ? parsed.config.servers[serverName] : undefined;
  if (!entry) return null;
  const fingerprint = entryFingerprint(entry);
  return stored.approved[serverName] === fingerprint ? { entry, fingerprint } : null;
}

type Discovered = { ok: true; state: OAuthDiscoveryState; issuer: string } | { ok: false; error: string };

/** The authorization server of `entry` (its `oauth.authServerMetadataUrl`, or discovery), as its metadata states it.
 *  Its `issuer` is what everything is bound to. */
async function discover(entry: McpServerEntry, d: OAuthDeps, redact: (t: string) => string): Promise<Discovered> {
  try {
    const info = await discoverAuthServer(entry, d);
    const issuer = info.authorizationServerMetadata?.issuer;
    if (!issuer) return { ok: false, error: "the authorization server publishes no metadata" };
    return { ok: true, state: info, issuer };
  } catch (err) {
    return { ok: false, error: shortError(err instanceof Error ? err.message : String(err), redact) };
  }
}

/** What both legs share of the provider: OpenLen as a client, the discovery done here, and the client to use. */
function flowProvider(
  personId: string,
  serverName: string,
  entry: McpServerEntry,
  d: OAuthDeps,
  discovery: OAuthDiscoveryState,
  issuer: string,
  own: StoredOAuthClientInformation | null,
): Pick<OAuthClientProvider, "redirectUrl" | "clientMetadata" | "clientMetadataUrl" | "discoveryState" | "clientInformation" | "saveClientInformation"> {
  return {
    redirectUrl: callbackUrl(d.siteUrl),
    clientMetadata: clientMetadata(d.siteUrl),
    // The SDK uses it only when the authorization server says it supports Client ID Metadata Documents (§5.2 step 4).
    clientMetadataUrl: clientMetadataUrl(d.siteUrl),
    discoveryState: () => discovery,
    async clientInformation(ctx) {
      // The SDK resolved the issuer from the discovery handed to it; anything else is not this flow's server.
      // Defence in depth: behind the discovery comparison (`found.issuer !== flow.issuer`) this can't fire today.
      if (!ctx || ctx.issuer !== issuer) throw new AuthorizationServerMismatchError(issuer, ctx?.issuer ?? "");
      if (own) return { ...own, issuer };
      return (await d.store.loadConnection(personId, serverName, entry.url, issuer))?.clientInfo;
    },
    async saveClientInformation(info, ctx) {
      // A client the provider gave OpenLen (CIMD or dynamic registration): bound to this server's URL and issuer.
      await d.store.saveClientInfo(personId, serverName, entry.url, ctx?.issuer ?? issuer, info);
    },
  };
}

/**
 * «Conectar»: the authorization URL for the person to open (§5.4 step 2). `opts.scope` is what the server last asked
 * for (a 403 `insufficient_scope`, §10.6); it joins the entry's own `oauth.scope`.
 */
export async function startSignIn(personId: string, serverName: string, d: StartDeps, opts: { scope?: string } = {}): Promise<StartResult> {
  const approved = approvedEntry(await d.readConfig(personId), serverName);
  if (!approved) return { ok: false, reason: "not_approved", error: `"${serverName}" is not an approved connector` };
  const { entry, fingerprint } = approved;

  const values = await d.resolveCredentials(personId, credentialRefsOf(entry));
  const resolved = resolveEntry(entry, values);
  if (!resolved.ok) return { ok: false, reason: "no_client", error: `missing: ${resolved.missing.join(", ")}` };
  const redact = makeRedactor(resolved.resolved);

  const found = await discover(entry, d, redact);
  if (!found.ok) return { ok: false, reason: "unreachable", error: found.error };
  const { issuer } = found;

  const own = await entryClient(personId, entry, issuer, d);
  if (isClientRefusal(own)) return { ok: false, reason: "no_client", error: shortError(own.detail, redact) };
  const metadata = found.state.authorizationServerMetadata;
  if (!own && !metadata?.registration_endpoint && !metadata?.client_id_metadata_document_supported) {
    if (!(await d.store.loadConnection(personId, serverName, entry.url, issuer))) {
      return { ok: false, reason: "no_client", error: "the authorization server takes no new clients: set oauth.clientId in mcp.json" };
    }
  }
  // The entry's (or OpenLen's) client gets the row now, so the tokens have a binding to land in — without its secret.
  if (own) await d.store.saveClientInfo(personId, serverName, entry.url, issuer, storableClient({ ...own, issuer }));

  let verifier: string | undefined;
  let authorizationUrl: URL | undefined;
  const provider: OAuthClientProvider = {
    ...flowProvider(personId, serverName, entry, d, found.state, issuer, own),
    // Signing in always asks the person: a refresh token from before is not this flow's business.
    tokens: () => undefined,
    saveTokens() {
      throw new Error("starting a sign-in never saves tokens");
    },
    saveCodeVerifier(v) {
      verifier = v;
    },
    codeVerifier() {
      if (verifier === undefined) throw new Error("no code verifier yet");
      return verifier;
    },
    // The SDK asks for `state()` before it makes the PKCE pair, and the flow's row keeps the verifier: so the flow is
    // made here, with both, and its `state` goes into the URL the SDK built.
    async redirectToAuthorization(url) {
      if (verifier === undefined) throw new Error("no code verifier yet");
      // The person's browser opens this URL: whatever the metadata said, it is https or nothing (and no flow is made).
      if (url.protocol !== "https:") throw new AuthorizationEndpointNotHttps();
      const state = await d.store.createFlow({ personId, serverName, fingerprint, issuer, codeVerifier: verifier, scope: url.searchParams.get("scope"), now: d.now() });
      url.searchParams.set("state", state);
      authorizationUrl = url;
    },
    invalidateCredentials() {},
  };

  try {
    const result = await auth(provider, { serverUrl: entry.url, scope: computeScopeUnion(entry.oauth?.scope, opts.scope), fetchFn: d.fetch });
    if (result !== "REDIRECT" || !authorizationUrl) return { ok: false, reason: "unreachable", error: "the authorization server did not ask the person to sign in" };
    return { ok: true, authorizationUrl: authorizationUrl.toString() };
  } catch (err) {
    if (err instanceof AuthorizationEndpointNotHttps) return { ok: false, reason: "unreachable", error: err.message };
    return { ok: false, reason: "unreachable", error: shortError(err instanceof Error ? err.message : String(err), redact) };
  }
}

/**
 * The way back from the provider (§5.4 step 3): spend the `state`, check it is still what the person approved, exchange
 * the code with the SDK, save the tokens and mount the server. `sessionPersonId` is only a cross-check: null (the
 * phone's browser, no cookie) trusts the `state`.
 */
export async function finishSignIn(
  q: { state: string; code?: string; error?: string; iss?: string },
  sessionPersonId: string | null,
  d: FinishDeps,
): Promise<FinishResult> {
  if (!q.state) return { ok: false, reason: "unknown" };
  const flow = await d.store.takeFlow(q.state, d.now());
  if (typeof flow === "string") return { ok: false, reason: flow };
  if (sessionPersonId !== null && sessionPersonId !== flow.personId) return { ok: false, reason: "unknown" };
  const server = flow.serverName;

  const approved = approvedEntry(await d.readConfig(flow.personId), server);
  if (!approved || approved.fingerprint !== flow.fingerprint) return { ok: false, reason: "changed", server };
  const { entry } = approved;
  if (q.error !== undefined) return { ok: false, reason: "denied", server };
  if (!q.code) return { ok: false, reason: "exchange_failed", server };
  // RFC 9207: an `iss` on the way back names who minted the code. Not the flow's issuer → a mix-up, never exchanged.
  if (q.iss !== undefined && q.iss !== flow.issuer) return { ok: false, reason: "issuer_changed", server };

  const values = await d.resolveCredentials(flow.personId, credentialRefsOf(entry));
  const resolved = resolveEntry(entry, values);
  if (!resolved.ok) return { ok: false, reason: "exchange_failed", server };
  const redact = makeRedactor(resolved.resolved);

  const found = await discover(entry, d, redact);
  if (!found.ok) return { ok: false, reason: "exchange_failed", server };
  if (found.issuer !== flow.issuer) return { ok: false, reason: "issuer_changed", server };

  const own = await entryClient(flow.personId, entry, flow.issuer, d);
  if (isClientRefusal(own)) return { ok: false, reason: "exchange_failed", server };

  const provider: OAuthClientProvider = {
    ...flowProvider(flow.personId, server, entry, d, found.state, flow.issuer, own),
    tokens: () => undefined,
    async saveTokens(tokens, ctx) {
      await d.store.saveTokens(flow.personId, server, entry.url, ctx?.issuer ?? flow.issuer, tokens);
    },
    saveCodeVerifier() {},
    codeVerifier: () => flow.codeVerifier,
    redirectToAuthorization() {
      throw new Error("the way back never starts another sign-in");
    },
    // A rejected code (spent, replayed) must not cost the person the tokens an earlier sign-in saved: the SDK's
    // recovery from `invalid_grant` drops credentials, and here there is nothing to drop.
    invalidateCredentials() {},
  };

  try {
    const result = await auth(provider, { serverUrl: entry.url, authorizationCode: q.code, iss: q.iss, scope: flow.scope ?? undefined, fetchFn: d.fetch });
    if (result !== "AUTHORIZED") return { ok: false, reason: "exchange_failed", server };
  } catch (err) {
    if (AuthorizationServerMismatchError.isInstance(err)) return { ok: false, reason: "issuer_changed", server };
    return { ok: false, reason: "exchange_failed", server };
  }
  await d.mount(flow.personId, server).catch(() => null);
  return { ok: true, server };
}
