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
//
// Which 401 is a sign-in (§5.1): the SDK runs its OAuth on EVERY 401, whatever the server asked for, and falls back to the
// server's own origin as the issuer when nothing is published. A server keyed by `X-API-Key` that answers a wrong key with
// 401 is not asking anyone to sign in. So a 401 is a sign-in only when the server is OAuth's by what OpenLen knows: the
// entry has an `oauth` block, the person has a connection for this entry (or had one this connection dropped), or the 401
// carried a `WWW-Authenticate: Bearer` (or `DPoP`) challenge AND real authorization-server metadata was discovered behind
// it. Anything else is `NotASignIn`: the caller connects again without OAuth, exactly as with `OPENLEN_MCP_OAUTH=0`.
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

import { entryFingerprint, type McpServerEntry } from "../config";
import { credentialRefs } from "../templates";
import { callbackUrl, clientMetadata, isClientRefusal, preRegisteredClient, type ClientRefusal } from "./clients";
import { cleanIssuer, cleanScope } from "./remote-text";
import type { OAuthConnection, OAuthFlow } from "./store";

/** What the provider and the flow use of store.ts — an interface, so tests can hand the real one or a fake. */
export interface OAuthStore {
  /** Only the connection signed in with the entry of that fingerprint (and URL, and issuer when given): else null. */
  loadConnection(personId: string, serverName: string, serverUrl: string, issuer: string | null, fingerprint: string): Promise<OAuthConnection | null>;
  saveClientInfo(personId: string, serverName: string, serverUrl: string, issuer: string, fingerprint: string, info: StoredOAuthClientInformation): Promise<void>;
  saveTokens(personId: string, serverName: string, serverUrl: string, issuer: string, fingerprint: string, tokens: StoredOAuthTokens): Promise<void>;
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
 *  names and asks for; both come from the servers, so they are shown, never followed — and kept in bounds from here on
 *  (remote-text.ts): an issuer that isn't an https URL is null, a scope is one short line of scope tokens. */
export class NeedsSignIn extends Error {
  readonly issuer: string | null;
  readonly scope: string | null;
  constructor(
    readonly reason: SignInReason,
    issuer: string | null,
    scope: string | null,
  ) {
    super(reason === "scope" ? "needs additional permissions" : reason === "lapsed" ? "needs you to sign in again" : "needs authentication");
    this.name = "NeedsSignIn";
    this.issuer = cleanIssuer(issuer);
    this.scope = cleanScope(scope);
  }
}

/** A 401 from a server that isn't OAuth's (§5.1): no `oauth` block, no connection of the person's, and no Bearer challenge
 *  with real authorization-server metadata behind it. Not a sign-in and not shown to anyone: `openMcp` connects again
 *  without OAuth, so what the person and Len read is what they read with OAuth off. */
export class NotASignIn extends Error {
  constructor() {
    super("the server answered 401 (Unauthorized) and asked for no OAuth sign-in");
    this.name = "NotASignIn";
  }
}

/** Whether a `WWW-Authenticate` header carries an OAuth challenge (RFC 6750 `Bearer`, RFC 9449 `DPoP`) — among several
 *  challenges too. Quoted parameter values are read as values, never as schemes. */
export function hasOAuthChallenge(header: string | null): boolean {
  if (!header) return false;
  const unquoted = header.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return /(?:^|,)\s*(?:bearer|dpop)(?=\s|,|$)/i.test(unquoted);
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

/** The most of a metadata document that is read: the body is read as a stream and the read stops (and fails) past it. */
const MAX_METADATA_BYTES = 64 * 1024;

/** RFC 8414 fields that must be https URLs when present; the first two always are. */
const REQUIRED_ENDPOINTS = ["authorization_endpoint", "token_endpoint"] as const;
const OPTIONAL_ENDPOINTS = ["registration_endpoint", "revocation_endpoint"] as const;
/** The `*_supported` fields the flow reads that are flags; every other `*_supported` field it reads is a list. */
const FLAGS = ["client_id_metadata_document_supported", "authorization_response_iss_parameter_supported"] as const;
const LISTS = [
  "response_types_supported",
  "grant_types_supported",
  "code_challenge_methods_supported",
  "token_endpoint_auth_methods_supported",
  "scopes_supported",
  "revocation_endpoint_auth_methods_supported",
] as const;

function isHttps(v: unknown): boolean {
  if (typeof v !== "string") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** The body, read as a stream and cut off past `max` bytes: a huge document is never held whole. */
async function readCapped(r: Response, max: number): Promise<string> {
  const reader = r.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new Error("the authorization server metadata is too large");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** The metadata document at an entry's `oauth.authServerMetadataUrl`: untrusted JSON, checked at least as strictly as
 *  the SDK's own schema checks discovered metadata for what the flow uses — an https issuer on the same origin as the
 *  document's own URL (its endpoints may be elsewhere: some providers split them), https endpoints (an
 *  `authorization_endpoint` is a URL the person's browser opens: never `javascript:` or `data:`), lists of strings,
 *  booleans for the flags, `code` among the response types. Never followed through a redirect. */
async function fetchAuthServerMetadata(url: string, fetchFn: typeof fetch): Promise<AuthorizationServerMetadata> {
  const r = await fetchFn(url, { headers: { Accept: "application/json" }, redirect: "manual" });
  if (!r.ok) {
    await r.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${r.status} loading the authorization server metadata from oauth.authServerMetadataUrl`);
  }
  const text = await readCapped(r, MAX_METADATA_BYTES);
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("the authorization server metadata is not JSON");
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("the authorization server metadata is not an object");
  const m = doc as Record<string, unknown>;
  if (!isHttps(m.issuer)) throw new Error("the authorization server metadata has no https issuer");
  // A document is the word of whoever serves it: one that names an issuer on another origin claims to be a server it
  // isn't (a person's connection is bound to an issuer, and a revocation or a refresh goes to the endpoints it lists).
  if (new URL(m.issuer as string).origin !== new URL(url).origin) {
    throw new Error("the authorization server metadata's issuer is not on the same origin as oauth.authServerMetadataUrl");
  }
  for (const k of REQUIRED_ENDPOINTS) if (!isHttps(m[k])) throw new Error(`the authorization server metadata's ${k} is not an https URL`);
  for (const k of OPTIONAL_ENDPOINTS) if (m[k] !== undefined && !isHttps(m[k])) throw new Error(`the authorization server metadata's ${k} is not an https URL`);
  for (const k of LISTS) {
    const v = m[k];
    if (v !== undefined && !(Array.isArray(v) && v.every((x) => typeof x === "string"))) throw new Error(`the authorization server metadata's ${k} is not a list of strings`);
  }
  for (const k of FLAGS) if (m[k] !== undefined && typeof m[k] !== "boolean") throw new Error(`the authorization server metadata's ${k} is not true or false`);
  if (!(m.response_types_supported as string[] | undefined)?.includes("code")) {
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
export async function entryClient(
  personId: string,
  entry: McpServerEntry,
  issuer: string,
  d: OAuthDeps,
): Promise<StoredOAuthClientInformation | ClientRefusal | null> {
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
  /** The sign-in an error from connecting, listing or calling stands for, or null when it is some other failure. */
  signInNeededBy(err: unknown): Promise<NeedsSignIn | null>;
  /** The `WWW-Authenticate` of a 401 from the MCP server itself (`openMcp` hands it over before the SDK runs its OAuth). */
  noteUnauthorized(wwwAuthenticate: string | null): void;
}

/** The one place a failed connection becomes «needs a sign-in» (§5.4 steps 1 and 4): at connecting, in the middle of a
 *  session (a 401 or a 403 `insufficient_scope` from `listTools` or a call) and in a turn. No provider — a server with
 *  its own `Authorization` header, or OAuth off — never turns an error into a sign-in; and a provider that can't tell
 *  (its own store failing) leaves the error as it was. */
export async function asNeedsSignIn(provider: ConnectionProvider | undefined, err: unknown): Promise<NeedsSignIn | null> {
  if (!provider) return null;
  return provider.signInNeededBy(err).catch(() => null);
}

/** The provider for connecting to `serverName` in a mount or a turn (§5.4 steps 1 and 4). */
export function connectionProvider(personId: string, serverName: string, entry: McpServerEntry, d: OAuthDeps): ConnectionProvider {
  // The connection is the one signed in with THIS entry (this fingerprint): an edited entry finds none, and the tokens of
  // the entry it was before are never sent anywhere it names.
  const fingerprint = entryFingerprint(entry);
  let issuer: string | null = null;
  let lapsed = false;
  /** A 401 of the MCP server asked for a Bearer (or DPoP) token. */
  let challenged = false;
  /** The SDK's discovery found real authorization-server metadata (not its fallback to the server's own origin). */
  let discovered = false;
  /** Is this server OAuth's by what OpenLen knows (the header above)? `afterDiscovery`: the discovery has run. */
  const isOAuths = async (afterDiscovery: boolean): Promise<boolean> => {
    if (entry.oauth || lapsed) return true;
    if (challenged && (!afterDiscovery || discovered)) return true;
    return (await d.store.loadConnection(personId, serverName, entry.url, null, fingerprint)) !== null;
  };
  // A person who had signed in before (a token is stored, or it was just dropped) signs in AGAIN; one who never did
  // signs in for the first time. `row` is what the caller just read, when it did.
  const needs = async (row?: OAuthConnection | null) => {
    const stored = row === undefined ? await d.store.loadConnection(personId, serverName, entry.url, issuer, fingerprint) : row;
    return new NeedsSignIn(lapsed || stored?.tokens ? "lapsed" : "first", issuer ?? stored?.issuer ?? null, null);
  };
  const provider: ConnectionProvider = {
    // The SDK needs a return address to treat this as the authorization-code client it is; it never gets to use it.
    get redirectUrl() {
      return callbackUrl(d.siteUrl);
    },
    get clientMetadata() {
      return clientMetadata(d.siteUrl);
    },
    // The SDK's first question on a 401, before any discovery request leaves: a server that is plainly not OAuth's (no
    // block, no connection, no Bearer challenge) is answered here, and nobody's well-known paths are asked. Only an entry
    // that names its metadata URL hands the SDK a discovery; the rest discover as the SDK does.
    async discoveryState() {
      if (!(await isOAuths(false))) throw new NotASignIn();
      return entry.oauth?.authServerMetadataUrl ? discoverAuthServer(entry, d) : undefined;
    },
    saveDiscoveryState(state: OAuthDiscoveryState) {
      if (state.authorizationServerMetadata !== undefined) discovered = true;
    },
    async clientInformation(ctx?: OAuthClientInformationContext) {
      if (!ctx) return undefined;
      issuer = ctx.issuer;
      const own = await entryClient(personId, entry, ctx.issuer, d);
      if (isClientRefusal(own)) throw new OAuthClientRefused(own);
      if (own) return { ...own, issuer: ctx.issuer };
      const stored = await d.store.loadConnection(personId, serverName, entry.url, ctx.issuer, fingerprint);
      if (stored) return stored.clientInfo;
      // Registering a client is part of signing in, never of connecting.
      if (!(await isOAuths(true))) throw new NotASignIn();
      throw await needs(null);
    },
    async tokens(ctx?: OAuthClientInformationContext) {
      // Without ctx it is the per-request read for this very server URL: the row's issuer is the one.
      const c = await d.store.loadConnection(personId, serverName, entry.url, ctx?.issuer ?? null, fingerprint);
      return c?.tokens ?? undefined;
    },
    async saveTokens(tokens: StoredOAuthTokens, ctx?: OAuthClientInformationContext) {
      const at = ctx?.issuer ?? tokens.issuer;
      if (!at) throw new Error("tokens without an issuer are never saved");
      await d.store.saveTokens(personId, serverName, entry.url, at, fingerprint, tokens);
    },
    async redirectToAuthorization() {
      if (!(await isOAuths(true))) throw new NotASignIn();
      throw await needs();
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
      if (err instanceof NotASignIn) return null;
      // A 403 asking for more scope is a step-up of an OAuth sign-in: of a server that isn't OAuth's it is just a 403.
      if (InsufficientScopeError.isInstance(err)) {
        if (!(await isOAuths(true))) return null;
        const had = await provider.tokens();
        return new NeedsSignIn("scope", had?.issuer ?? issuer, computeScopeUnion(had?.scope, err.requiredScope) ?? null);
      }
      if (UnauthorizedError.isInstance(err)) return (await isOAuths(true)) ? needs() : null;
      return null;
    },
    noteUnauthorized(wwwAuthenticate: string | null) {
      if (hasOAuthChallenge(wwwAuthenticate)) challenged = true;
    },
  };
  return provider;
}
