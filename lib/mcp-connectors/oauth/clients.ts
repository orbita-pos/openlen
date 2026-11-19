// WHICH OAUTH CLIENT OPENLEN USES FOR A CONNECTOR (spec local 2026-11-17-oauth-de-conectores-mcp, §5.2). Pure.
//
// The order is the SDK's, with one step added in third place: (1) the client already stored for that person, server and
// issuer — the provider's job, not this module's —, (2) the `oauth.clientId` the entry names, (3) OpenLen's own client
// for that issuer AT THE SERVER THE DIRECTORY OFFERS FOR IT (Google's, which is what claude.ai does too; never for a
// server somebody else chose, whatever authorization server it names), (4) OpenLen's Client ID Metadata
// Document and (5) dynamic registration — both the SDK's, which carries on when `preRegisteredClient` answers null —,
// and (6) none, which the caller reports as needing `oauth.clientId`. This file answers steps 2 and 3 and says what
// OpenLen tells the provider about itself (the metadata for steps 4 and 5, the return address, the document's URL).
import type { OAuthClientMetadata, StoredOAuthClientInformation } from "@modelcontextprotocol/client";

import type { McpServerEntry } from "../config";
import { GOOGLE_ISSUER, isDirectoryServer } from "../directory-entries";
import { credentialRefs } from "../templates";

/** What the person sees on the provider's consent screen. */
const CLIENT_NAME = "OpenLen";

/** A single return address, with no locale: a provider has it registered once and exactly. */
const CALLBACK_PATH = "/api/mcp-connectors/oauth/callback";
/** OpenLen's Client ID Metadata Document, served by OpenLen (a route of its own). */
const CLIENT_METADATA_PATH = "/oauth/mcp-client.json";

type Env = Readonly<Record<string, string | undefined>>;

/** `https://openlen.com/` and `https://openlen.com` are the same site, and the two paths above start with a slash of
 *  their own: the site URL loses its trailing slashes so the join never doubles one. Only for OpenLen's own URL — an
 *  issuer is an identity and is never tidied. */
function trimSlashes(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "");
}

/** Why the entry's own client can't be used right now. `detail` is safe to show: an issuer, or a credential NAME —
 *  never a value. */
export type ClientRefusal = { readonly refused: "missing_secret" | "issuer_not_allowed"; readonly detail: string };

export function isClientRefusal(x: StoredOAuthClientInformation | ClientRefusal | null): x is ClientRefusal {
  return x !== null && typeof x === "object" && "refused" in x;
}

/**
 * OpenLen's own client for an issuer at a server: Google's, with both variables set, and ONLY when `serverUrl` is exactly
 * the URL of a directory entry that lists `issuer` as its authorization server (directory-entries.ts). The issuer comes
 * from metadata the MCP server points at, so a server nobody curated could name Google and be signed in with a client
 * the person's consent screen calls «OpenLen» — and receive the token. Nothing for any other pair.
 */
export function openLenClientFor(issuer: string, serverUrl: string, env: Env = process.env): { client_id: string; client_secret: string } | null {
  if (issuer !== GOOGLE_ISSUER || !isDirectoryServer(serverUrl, issuer)) return null;
  const clientId = env.OPENLEN_MCP_GOOGLE_CLIENT_ID;
  const clientSecret = env.OPENLEN_MCP_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { client_id: clientId, client_secret: clientSecret };
}

/**
 * The client OpenLen has ready for a server before asking the provider for one: the entry's own `oauth.clientId` (with
 * its `clientSecret` — a `${credential:NAME}` reference — resolved from `secrets`, the person's credential values by
 * NAME), else OpenLen's client for that issuer, else null (the SDK carries on with the metadata document and dynamic
 * registration).
 *
 * An entry that names a client names it for good, so two things are a REFUSAL, never a null and never the next step:
 *  - `issuer_not_allowed`: the entry lists the issuers its client is for (`oauth.authorizationServer`, which config.ts
 *    requires whenever a secret is set — Claude Code's rule) and `issuer` is not exactly one of them. The issuer comes
 *    from the metadata the MCP server points at, so a server that is not what the person configured could name its own
 *    authorization server to collect the client's secret; the secret is never even read in that case.
 *  - `missing_secret`: the secret's value hasn't been typed yet (`detail` is the credential NAME). A confidential
 *    client sent without its secret fails at the token endpoint with an error that blames the provider, and a null
 *    would let the SDK register OpenLen's client with CIMD or dynamic registration as if the entry named none.
 * In both, OpenLen's own client for that issuer must not stand in either. The issuer is checked first.
 */
export function preRegisteredClient(
  entry: McpServerEntry,
  issuer: string,
  secrets: ReadonlyMap<string, string>,
  env: Env = process.env,
): StoredOAuthClientInformation | ClientRefusal | null {
  const own = entry.oauth;
  if (own?.clientId) {
    if (own.authorizationServer && !own.authorizationServer.includes(issuer)) {
      return { refused: "issuer_not_allowed", detail: `${issuer} is not in oauth.authorizationServer` };
    }
    if (own.clientSecret === undefined) return { client_id: own.clientId };
    // config.ts guarantees exactly one reference. If a malformed entry ever got here, `detail` still must not echo the
    // text (it could be a literal secret): it names the field instead.
    const name = credentialRefs(own.clientSecret)[0];
    const secret = name === undefined ? undefined : secrets.get(name);
    return secret ? { client_id: own.clientId, client_secret: secret } : { refused: "missing_secret", detail: name ?? "oauth.clientSecret" };
  }
  return openLenClientFor(issuer, entry.url, env);
}

/** Where the provider sends the person back (and the one address registered with it). */
export function callbackUrl(siteUrl: string): string {
  return `${trimSlashes(siteUrl)}${CALLBACK_PATH}`;
}

/** The URL of OpenLen's Client ID Metadata Document: a provider that supports it takes this as the client's id. */
export function clientMetadataUrl(siteUrl: string): string {
  return `${trimSlashes(siteUrl)}${CLIENT_METADATA_PATH}`;
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
