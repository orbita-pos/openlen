// lib/google-calendar-mcp/connector.test.ts
// @vitest-environment node
//
// The directory's Google Calendar end to end, in process (spec local 2026-11-24-servidor-de-google-calendar, §5.5): Len's
// connector client (lib/mcp-connectors/client.ts, mounted by mount.ts with OAuth on) against OpenLen's Calendar server
// (server.ts) at the URL the directory offers. Signed in, the nine tools pass the connectors' review and are stored;
// without a token, the server's 401 sends the connector to Google — the server is in needs-auth, never failed.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as resourceMetadata } from "@/app/api/mcp/google-calendar/resource-metadata/route";
import { openMcp } from "@/lib/mcp-connectors/client";
import { entryFingerprint, parseMcpConfig } from "@/lib/mcp-connectors/config";
import { DIRECTORY, GOOGLE_ISSUER } from "@/lib/mcp-connectors/directory-entries";
import { mountServer, type MountDeps } from "@/lib/mcp-connectors/mount";
import type { OAuthDeps } from "@/lib/mcp-connectors/oauth/provider";
import type { OAuthConnection } from "@/lib/mcp-connectors/oauth/store";
import type { ServerState } from "@/lib/mcp-connectors/store";

import { gcalResourceMetadataUrl, GCAL_SCOPES } from "./config";
import { buildGcalMcpHandler } from "./server";
import { resetTokenCache } from "./token";
import { GCAL_TOOLS } from "./tools";

const NOW = new Date("2027-01-15T12:00:00Z");
const CLIENT = "openlen-client.apps.googleusercontent.com";
const TOKEN = "ya29.connector";

const GCAL = DIRECTORY.find((d) => d.id === "google-calendar")!;
const TEXT = JSON.stringify({ servers: { [GCAL.server]: GCAL.entry } });
const parsed = parseMcpConfig(TEXT, { reservedServerNames: new Set() });
if (!parsed.ok) throw new Error(parsed.error);
const FP = entryFingerprint(parsed.config.servers[GCAL.server]!);

const hrefOf = (input: RequestInfo | URL) => (input instanceof Request ? input.url : String(input));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Google as far as this needs it: tokeninfo knows one token with the three scopes, and its OpenID discovery document
 *  (the fields the SDK checks, as accounts.google.com serves them). */
const google = async (url: string, init?: RequestInit): Promise<Response> => {
  if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
    const bearer = /^Bearer (.+)$/.exec(new Headers(init?.headers).get("authorization") ?? "")?.[1];
    if (init?.method !== "POST" || bearer !== TOKEN) return json({ error: "invalid_token" }, 400);
    return json({ azp: CLIENT, aud: CLIENT, scope: GCAL_SCOPES.join(" "), exp: String(Math.floor(NOW.getTime() / 1000) + 3600) });
  }
  if (url === "https://accounts.google.com/.well-known/openid-configuration") {
    return json({
      issuer: GOOGLE_ISSUER,
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token",
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
    });
  }
  return new Response("not found", { status: 404 });
};

const server = buildGcalMcpHandler({ clientId: CLIENT, fetch: (async (input: RequestInfo | URL, init?: RequestInit) => google(hrefOf(input), init)) as typeof fetch, now: () => NOW.getTime() });

/** The network the connector sees: OpenLen's Calendar server and its metadata at the directory's URLs, and Google. */
const net = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = hrefOf(input);
  if (url === GCAL.entry.url) return server(input instanceof Request ? input : new Request(url, init));
  if (url === gcalResourceMetadataUrl()) return resourceMetadata();
  return google(url, init);
}) as typeof fetch;

/** The person's stored sign-in, or none. Mounting only reads it. */
function oauthWith(connection: OAuthConnection | null): OAuthDeps {
  const never = async () => {
    throw new Error("mounting never writes the OAuth store");
  };
  return {
    store: {
      loadConnection: async () => connection,
      saveClientInfo: never,
      saveTokens: never,
      dropTokens: never,
      dropConnection: never,
      createFlow: never,
      takeFlow: never,
      holdTokens: never,
      takeHeldTokens: never,
      dropExpiredHeld: never,
    },
    fetch: net,
    siteUrl: "https://openlen.test",
    resolveCredentials: async () => new Map(),
    now: () => NOW,
    env: { OPENLEN_MCP_GOOGLE_CLIENT_ID: CLIENT, OPENLEN_MCP_GOOGLE_CLIENT_SECRET: "secret" },
  };
}

function mountDeps(connection: OAuthConnection | null) {
  const saved: ServerState[] = [];
  const d: MountDeps = {
    readConfig: async () => ({ text: TEXT, approved: { [GCAL.server]: FP }, version: 1 }),
    readStates: async () => [],
    saveState: async (_p, s) => {
      saved.push(s);
    },
    resolveCredentials: async () => new Map(),
    open: openMcp,
    fetch: net,
    now: () => NOW,
    oauth: oauthWith(connection),
  };
  return { d, saved };
}

const SIGNED_IN: OAuthConnection = {
  serverUrl: GCAL.entry.url,
  issuer: GOOGLE_ISSUER,
  fingerprint: FP,
  clientInfo: { client_id: CLIENT, redirect_uris: ["https://openlen.test/api/mcp-connectors/oauth/callback"] },
  tokens: { access_token: TOKEN, refresh_token: "1//rt", token_type: "Bearer", issuer: GOOGLE_ISSUER },
};

beforeEach(() => {
  resetTokenCache();
  vi.stubEnv("GCAL_MCP_RESOURCE_URL", "");
  vi.stubEnv("OPENLEN_GCAL_MCP", "");
  vi.stubEnv("OPENLEN_MCP", "");
});

describe("the directory's Google Calendar, mounted by Len's connector client", () => {
  it("signed in: connected, with the nine tools stored and nothing the review dropped", async () => {
    const { d, saved } = mountDeps(SIGNED_IN);
    const s = await mountServer("p1", GCAL.server, d);
    expect(s).toMatchObject({ serverName: GCAL.server, status: "connected", error: null, failures: 0 });
    expect(s?.tools.map((t) => t.rawName).sort()).toEqual(GCAL_TOOLS.map((t) => t.name).sort());
    expect(saved).toEqual([s]);
  });

  it("🔴 no token: the server's 401 leads to Google, and the server is in needs-auth (first), not failed", async () => {
    const { d } = mountDeps(null);
    const s = await mountServer("p1", GCAL.server, d);
    expect(s).toMatchObject({ status: "needs-auth", authReason: "first", authIssuer: GOOGLE_ISSUER, failures: 0, tools: [] });
  });
});
