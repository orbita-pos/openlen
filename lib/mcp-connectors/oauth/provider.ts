// THE OAUTH PROVIDER OF A CONNECTION (spec local 2026-11-17-oauth-de-conectores-mcp, §5.3, §5.4 step 4, §10.6). The
// SDK's `OAuthClientProvider` over the person's row (store.ts) for connecting in mounts and turns: the SDK puts the
// token on every request and refreshes it on a 401, and this provider never sends anyone anywhere — where the SDK would
// start an authorization (no token, a refresh rejected, a client gone) it throws `NeedsSignIn`, and the person signs in
// from «Conectar» (flow.ts). A 403 `insufficient_scope` becomes `NeedsSignIn("scope")` with the union of what the token
// had and what the server asks for (Claude Code's step-up message; the transport is told to throw, not reauthorize).
//
// Never registers a client: without one stored, or the entry's, there is nothing to connect with yet. Nothing here
// logs or returns a token, code or verifier.
//
// Where the authorization server is (§5.1, Claude Code's `oauth.authServerMetadataUrl`): an entry that names its metadata
// URL is taken at its word — that document, fetched with the deps' fetch, is the metadata, and RFC 9728 → RFC 8414
// discovery never runs for it. The issuer is still whatever that document states, and every issuer check still applies.
import {
  computeScopeUnion,
  discoverOAuthServerInfo,
  InsufficientScopeError,
  UnauthorizedError,
  type OAuthClientInformationContext,
  type AuthorizationServerMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";

import type { McpServerEntry } from "../config";
import { credentialRefs } from "../templates";
import { callbackUrl, clientMetadata, isClientRefusal, preRegisteredClient, type ClientRefusal } from "./clients";
import type { OAuthConnection, OAuthFlow } from "./store";

/** What the provider and the flow use of store.ts — an interface, so tests can hand the real one or a fake. */
export interface OAuthStore {
  loadConnection(personId: string, serverName: string, serverUrl: string, issuer: string | null): Promise<OAuthConnection | null>;
  saveClientInfo(personId: string, serverName: string, serverUrl: string, issuer: string, info: StoredOAuthClientInformation): Promise<void>;
  saveTokens(personId: string, serverName: string, serverUrl: string, issuer: string, tokens: StoredOAuthTokens): Promise<void>;
  dropTokens(personId: string, serverName: string): Promise<void>;
  dropConnection(personId: string, serverName: string): Promise<OAuthConnection | null>;
  createFlow(flow: { personId: string; serverName: string; fingerprint: string; issuer: string; codeVerifier: string; scope: string | null; now: Date }): Promise<string>;
  takeFlow(state: string, now: Date): Promise<OAuthFlow | "expired" | "used" | "unknown">;
}

export interface OAuthDeps {
  readonly store: OAuthStore;
  /** Every OAuth request (metadata, registration, token): the guarded fetch in production, a plain one in tests. */
  readonly fetch: typeof fetch;
  /** OpenLen's own site: the return address and the client metadata document hang from it. */
  readonly siteUrl: string;
  resolveCredentials(personId: string, names: readonly string[]): Promise<Map<string, string>>;
  now(): Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export type SignInReason = "first" | "lapsed" | "scope";

/** The server wants the person to sign in (again, or with more permissions). `issuer` and `scope` are what «Conectar»
 *  names and asks for; both come from the servers, so they are shown, never followed. */
export class NeedsSignIn extends Error {
  constructor(
    readonly reason: SignInReason,
    readonly issuer: string | null,
    readonly scope: string | null,
  ) {
    super(reason === "scope" ? "needs additional permissions" : reason === "lapsed" ? "needs you to sign in again" : "needs authentication");
    this.name = "NeedsSignIn";
  }
}

/** The entry names a client that can't be used now (clients.ts): the person fixes the entry or types the secret. */
export class OAuthClientRefused extends Error {
  constructor(readonly refusal: ClientRefusal) {
    super(`the OAuth client can't be used: ${refusal.detail}`);
    this.name = "OAuthClientRefused";
  }
}

const MAX_ERROR = 200;

/** Text from a remote server or a refusal, safe to pass on: redacted, on one line, short. */
export function shortError(text: string, redact: (t: string) => string = (t) => t): string {
  const one = redact(text).replace(/\s+/g, " ").trim();
  return one.length > MAX_ERROR ? `${one.slice(0, MAX_ERROR - 1)}…` : one;
}

const MAX_METADATA_BYTES = 64 * 1024;

/** The metadata document at an entry's `oauth.authServerMetadataUrl`. Checked for what the flow uses — an issuer, the
 *  two endpoints, `code` among the response types —, never followed through a redirect. */
async function fetchAuthServerMetadata(url: string, fetchFn: typeof fetch): Promise<AuthorizationServerMetadata> {
  const r = await fetchFn(url, { headers: { Accept: "application/json" }, redirect: "manual" });
  if (!r.ok) {
    await r.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${r.status} loading the authorization server metadata from oauth.authServerMetadataUrl`);
  }
  const text = await r.text();
  if (text.length > MAX_METADATA_BYTES) throw new Error("the authorization server metadata is too large");
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("the authorization server metadata is not JSON");
  }
  const m = doc as Record<string, unknown> | null;
  const str = (k: string) => typeof m?.[k] === "string" && (m[k] as string).length > 0;
  if (!m || typeof m !== "object" || !str("issuer") || !str("authorization_endpoint") || !str("token_endpoint")) {
    throw new Error("the authorization server metadata lacks issuer, authorization_endpoint or token_endpoint");
  }
  if (!Array.isArray(m.response_types_supported) || !m.response_types_supported.includes("code")) {
    throw new Error("the authorization server metadata does not support the code response type");
  }
  return m as unknown as AuthorizationServerMetadata;
}

/** The authorization server of `entry`: its `oauth.authServerMetadataUrl` when it names one, else RFC 9728 → RFC 8414
 *  discovery from the server URL (the SDK's). */
export async function discoverAuthServer(entry: McpServerEntry, d: Pick<OAuthDeps, "fetch">): Promise<OAuthDiscoveryState> {
  const manual = entry.oauth?.authServerMetadataUrl;
  if (!manual) return discoverOAuthServerInfo(entry.url, { fetchFn: d.fetch });
  const metadata = await fetchAuthServerMetadata(manual, d.fetch);
  return { authorizationServerUrl: metadata.issuer, authorizationServerMetadata: metadata };
}

/** The client the entry names (with its secret resolved now, so a rotated value is used at once) or OpenLen's own for
 *  this issuer — steps 2 and 3 of §5.2 —, a refusal, or null. */
export async function entryClient(personId: string, entry: McpServerEntry, issuer: string, d: OAuthDeps): Promise<StoredOAuthClientInformation | ClientRefusal | null> {
  const names = entry.oauth?.clientSecret ? credentialRefs(entry.oauth.clientSecret) : [];
  const secrets = names.length > 0 ? await d.resolveCredentials(personId, names) : new Map<string, string>();
  return preRegisteredClient(entry, issuer, secrets, d.env);
}

/** What the row keeps of a client: never its secret (the entry's comes back from the person's credentials, OpenLen's
 *  from the environment). */
export function storableClient(info: StoredOAuthClientInformation): StoredOAuthClientInformation {
  const { client_secret: _secret, ...rest } = info as StoredOAuthClientInformation & { client_secret?: string };
  return rest;
}

export interface ConnectionProvider extends OAuthClientProvider {
  /** The sign-in an error from connecting stands for, or null when it is some other failure. */
  signInNeededBy(err: unknown): Promise<NeedsSignIn | null>;
}

/** The provider for connecting to `serverName` in a mount or a turn (§5.4 steps 1 and 4). */
export function connectionProvider(personId: string, serverName: string, entry: McpServerEntry, d: OAuthDeps): ConnectionProvider {
  let issuer: string | null = null;
  let lapsed = false;
  const needs = () => new NeedsSignIn(lapsed ? "lapsed" : "first", issuer, null);
  const provider: ConnectionProvider = {
    // The SDK needs a return address to treat this as the authorization-code client it is; it never gets to use it.
    get redirectUrl() {
      return callbackUrl(d.siteUrl);
    },
    get clientMetadata() {
      return clientMetadata(d.siteUrl);
    },
    // Only an entry that names its metadata URL hands the SDK a discovery; the rest discover as the SDK does.
    ...(entry.oauth?.authServerMetadataUrl && { discoveryState: () => discoverAuthServer(entry, d) }),
    async clientInformation(ctx?: OAuthClientInformationContext) {
      if (!ctx) return undefined;
      issuer = ctx.issuer;
      const own = await entryClient(personId, entry, ctx.issuer, d);
      if (isClientRefusal(own)) throw new OAuthClientRefused(own);
      if (own) return { ...own, issuer: ctx.issuer };
      const stored = await d.store.loadConnection(personId, serverName, entry.url, ctx.issuer);
      if (stored) return stored.clientInfo;
      // Registering a client is part of signing in, never of connecting.
      throw needs();
    },
    async tokens(ctx?: OAuthClientInformationContext) {
      // Without ctx it is the per-request read for this very server URL: the row's issuer is the one.
      const c = await d.store.loadConnection(personId, serverName, entry.url, ctx?.issuer ?? null);
      return c?.tokens ?? undefined;
    },
    async saveTokens(tokens: StoredOAuthTokens, ctx?: OAuthClientInformationContext) {
      const at = ctx?.issuer ?? tokens.issuer;
      if (!at) throw new Error("tokens without an issuer are never saved");
      await d.store.saveTokens(personId, serverName, entry.url, at, tokens);
    },
    redirectToAuthorization() {
      throw needs();
    },
    saveCodeVerifier() {},
    codeVerifier() {
      throw new Error("no sign-in runs while connecting");
    },
    async invalidateCredentials(scope) {
      // The SDK's answer to a rejected refresh (`invalid_grant`) or a client the provider no longer knows: the person
      // signs in again. A gone client takes the row with it, so the next sign-in registers a new one.
      if (scope === "tokens") {
        lapsed = true;
        await d.store.dropTokens(personId, serverName);
      } else if (scope === "client" || scope === "all") {
        lapsed = true;
        await d.store.dropConnection(personId, serverName);
      }
    },
    async signInNeededBy(err: unknown) {
      if (err instanceof NeedsSignIn) return err;
      if (InsufficientScopeError.isInstance(err)) {
        const had = await provider.tokens();
        return new NeedsSignIn("scope", had?.issuer ?? issuer, computeScopeUnion(had?.scope, err.requiredScope) ?? null);
      }
      if (UnauthorizedError.isInstance(err)) return needs();
      return null;
    },
  };
  return provider;
}
