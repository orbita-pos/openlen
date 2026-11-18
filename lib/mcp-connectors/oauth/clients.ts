// WHICH OAUTH CLIENT OPENLEN USES FOR A CONNECTOR (spec local 2026-11-17-oauth-de-conectores-mcp, §5.2). Pure.
//
// The order is the SDK's, with one step added in third place: (1) the client already stored for that person, server and
// issuer — the provider's job, not this module's —, (2) the `oauth.clientId` the entry names, (3) OpenLen's own client
// for that issuer (a table in code: Google's, which is what claude.ai does too), (4) OpenLen's Client ID Metadata
// Document and (5) dynamic registration — both the SDK's, which carries on when `preRegisteredClient` answers null —,
// and (6) none, which the caller reports as needing `oauth.clientId`. This file answers steps 2 and 3 and says what
// OpenLen tells the provider about itself (the metadata for steps 4 and 5, the return address, the document's URL).
import type { OAuthClientMetadata, StoredOAuthClientInformation } from "@modelcontextprotocol/client";

import type { McpServerEntry } from "../config";
import { credentialRefs } from "../templates";

/** The one issuer OpenLen has a client of its own for. Compared exactly: an issuer is an identity, not a URL to tidy. */
const GOOGLE_ISSUER = "https://accounts.google.com";

/** What the person sees on the provider's consent screen. */
const CLIENT_NAME = "OpenLen";

/** A single return address, with no locale: a provider has it registered once and exactly. */
const CALLBACK_PATH = "/api/mcp-connectors/oauth/callback";
/** OpenLen's Client ID Metadata Document, served by OpenLen (a route of its own). */
const CLIENT_METADATA_PATH = "/oauth/mcp-client.json";

type Env = Readonly<Record<string, string | undefined>>;

/** `https://openlen.com/` and `https://openlen.com` name the same site; the paths below start with their own slash. */
function origin(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "");
}

/** OpenLen's own client for an issuer: Google's, with both variables set; nothing for any other issuer. */
export function openLenClientFor(issuer: string, env: Env = process.env): { client_id: string; client_secret: string } | null {
  if (issuer !== GOOGLE_ISSUER) return null;
  const clientId = env.OPENLEN_MCP_GOOGLE_CLIENT_ID;
  const clientSecret = env.OPENLEN_MCP_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { client_id: clientId, client_secret: clientSecret };
}

/**
 * The client OpenLen has ready for a server before asking the provider for one: the entry's own `oauth.clientId` (with
 * its `clientSecret` — a `${credential:NAME}` reference — resolved from `secrets`, the person's credential values by
 * NAME), else OpenLen's client for that issuer, else null (the SDK carries on with the metadata document and dynamic
 * registration). The entry's client wins whatever the issuer is.
 *
 * An entry that names a secret whose value the person has not typed yet answers null, and NOT the next step: a
 * confidential client sent without its secret fails at the token endpoint with an error that blames the provider, and
 * quietly standing in OpenLen's client would sign the person in as somebody they didn't configure. The caller finds
 * the missing credential with `resolveEntry`, which names it.
 */
export function preRegisteredClient(
  entry: McpServerEntry,
  issuer: string,
  secrets: ReadonlyMap<string, string>,
  env: Env = process.env,
): StoredOAuthClientInformation | null {
  const own = entry.oauth;
  if (own?.clientId) {
    if (own.clientSecret === undefined) return { client_id: own.clientId };
    const name = credentialRefs(own.clientSecret)[0];
    const secret = name === undefined ? undefined : secrets.get(name);
    return secret ? { client_id: own.clientId, client_secret: secret } : null;
  }
  return openLenClientFor(issuer, env);
}

/** Where the provider sends the person back (and the one address registered with it). */
export function callbackUrl(siteUrl: string): string {
  return `${origin(siteUrl)}${CALLBACK_PATH}`;
}

/** The URL of OpenLen's Client ID Metadata Document: a provider that supports it takes this as the client's id. */
export function clientMetadataUrl(siteUrl: string): string {
  return `${origin(siteUrl)}${CLIENT_METADATA_PATH}`;
}

/** What OpenLen says about itself for the metadata document and dynamic registration: a public client, with PKCE. */
export function clientMetadata(siteUrl: string): OAuthClientMetadata {
  return {
    client_name: CLIENT_NAME,
    redirect_uris: [callbackUrl(siteUrl)],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}
