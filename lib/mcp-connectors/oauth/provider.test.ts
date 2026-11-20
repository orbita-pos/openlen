// @vitest-environment node
//
// What a connection provider says when the SDK can't go on (spec local 2026-11-17-oauth-de-conectores-mcp, §5.4 steps 1
// and 4): a first sign-in or a lapsed one, with the issuer it knows. The end-to-end roads are in flow.test.ts; here the
// store is a fake, so each branch is one line.
import { InsufficientScopeError, UnauthorizedError } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

import { entryFingerprint, type McpServerEntry } from "../config";
import { asNeedsSignIn, connectionProvider, NeedsSignIn, type OAuthDeps } from "./provider";
import type { OAuthConnection } from "./store";

const ISSUER = "https://accounts.example";
const ENTRY: McpServerEntry = { transport: "streamable-http", url: "https://mcp.example.com/mcp", headers: {}, enabled: true, startupTimeoutMs: 30_000, toolCallTimeoutMs: 60_000 };
const CLIENT = { client_id: "cid", redirect_uris: ["https://openlen.test/api/mcp-connectors/oauth/callback"] };

function setup(connection: OAuthConnection | null, entry: McpServerEntry = ENTRY) {
  const nothing = async () => {
    throw new Error("not used here");
  };
  const dropped: string[] = [];
  const oauth: OAuthDeps = {
    store: {
      // Like the real store: only the connection signed in with the entry of the fingerprint asked for.
      async loadConnection(_p, _n, serverUrl, _issuer, fingerprint) {
        return connection && connection.serverUrl === serverUrl && connection.fingerprint === fingerprint ? connection : null;
      },
      saveClientInfo: nothing,
      saveTokens: nothing,
      async dropTokens(_p, name) {
        dropped.push(`tokens:${name}`);
      },
      async dropConnection(_p, name) {
        dropped.push(`connection:${name}`);
        return null;
      },
      createFlow: nothing,
      takeFlow: nothing,
    },
    fetch: (async () => new Response()) as typeof fetch,
    siteUrl: "https://openlen.test",
    resolveCredentials: async () => new Map(),
    now: () => new Date("2026-11-17T10:00:00Z"),
  };
  return { provider: connectionProvider("p1", "cal", entry, oauth), dropped };
}

const SIGNED_IN: OAuthConnection = {
  serverUrl: ENTRY.url,
  issuer: ISSUER,
  fingerprint: entryFingerprint(ENTRY),
  clientInfo: CLIENT,
  tokens: { access_token: "at", token_type: "Bearer", issuer: ISSUER },
};
const CLIENT_ONLY: OAuthConnection = { ...SIGNED_IN, tokens: null };

describe("the entry a connection belongs to", () => {
  // Review fix, round 1: an edit that adds a client or a metadata URL of its own is another entry. It finds no tokens (so the
  // next refresh can't carry the person's to the endpoints it names) and asks for a first sign-in.
  const EDITED: McpServerEntry = { ...ENTRY, oauth: { clientId: "x", authServerMetadataUrl: "https://evil.example/m" } };

  it("🔴 uses the stored tokens only with the entry they were signed in with", async () => {
    expect(await setup(SIGNED_IN).provider.tokens()).toMatchObject({ access_token: "at" });
    expect(await setup(SIGNED_IN, EDITED).provider.tokens()).toBeUndefined();
  });

  it("🔴 an edited entry asks for a FIRST sign-in, never a refresh of the old tokens", async () => {
    const { provider } = setup(SIGNED_IN, EDITED);
    expect(await provider.signInNeededBy(new UnauthorizedError("401"))).toMatchObject({ reason: "first" });
  });
});

describe("the reason a sign-in is needed", () => {
  it("a person who never signed in is asked for a first sign-in, with no issuer until one is known", async () => {
    const { provider } = setup(null);
    expect(await provider.signInNeededBy(new UnauthorizedError("401"))).toMatchObject({ reason: "first", issuer: null, scope: null });
  });

  it("🔴 a person whose token is stored signs in AGAIN when the server stops taking it, naming the issuer of that row", async () => {
    const { provider } = setup(SIGNED_IN);
    expect(await provider.signInNeededBy(new UnauthorizedError("401"))).toMatchObject({ reason: "lapsed", issuer: ISSUER });
  });

  it("a client with no token yet (they started and stopped) is still a first sign-in", async () => {
    const { provider } = setup(CLIENT_ONLY);
    expect(await provider.signInNeededBy(new UnauthorizedError("401"))).toMatchObject({ reason: "first", issuer: ISSUER });
  });

  it("🔴 where the SDK would send the person off to sign in, an expired token it can't refresh is lapsed and never redirects", async () => {
    const { provider } = setup(SIGNED_IN);
    const err = await Promise.resolve(provider.redirectToAuthorization(new URL("https://accounts.example/authorize"))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NeedsSignIn);
    expect(err).toMatchObject({ reason: "lapsed", issuer: ISSUER });
    const fresh = await Promise.resolve(setup(null).provider.redirectToAuthorization(new URL("https://accounts.example/authorize"))).catch((e: unknown) => e);
    expect(fresh).toMatchObject({ reason: "first" });
  });

  it("a rejected refresh drops the tokens and the next ask is lapsed even though the row has none left", async () => {
    const { provider, dropped } = setup(CLIENT_ONLY);
    await provider.invalidateCredentials?.("tokens");
    expect(dropped).toEqual(["tokens:cal"]);
    expect(await provider.signInNeededBy(new UnauthorizedError("401"))).toMatchObject({ reason: "lapsed" });
  });

  it("a client the person has no connection for (gone, or for another URL) is a first sign-in", async () => {
    const { provider } = setup(null);
    const err = await Promise.resolve(provider.clientInformation?.({ issuer: ISSUER } as never)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NeedsSignIn);
    expect(err).toMatchObject({ reason: "first", issuer: ISSUER });
  });

  it("a 403 insufficient_scope asks for what the token had plus what is wanted, and is handed back as it came when nothing was stored", async () => {
    const withScope = { ...SIGNED_IN, tokens: { ...SIGNED_IN.tokens!, scope: "a" } };
    expect(await setup(withScope).provider.signInNeededBy(new InsufficientScopeError({ requiredScope: "b" }))).toMatchObject({ reason: "scope", scope: "a b", issuer: ISSUER });
    expect(await setup(null).provider.signInNeededBy(new InsufficientScopeError({ requiredScope: "b" }))).toMatchObject({ reason: "scope", scope: "b" });
  });

  it("an error that isn't a sign-in is none, and a NeedsSignIn goes through as it is", async () => {
    const { provider } = setup(SIGNED_IN);
    expect(await provider.signInNeededBy(new Error("boom"))).toBeNull();
    const own = new NeedsSignIn("lapsed", ISSUER, null);
    expect(await provider.signInNeededBy(own)).toBe(own);
  });
});

describe("asNeedsSignIn", () => {
  it("🔴 without a provider nothing is a sign-in: a server with its own Authorization header, or OAuth off", async () => {
    expect(await asNeedsSignIn(undefined, new UnauthorizedError("401"))).toBeNull();
    expect(await asNeedsSignIn(undefined, new NeedsSignIn("first", ISSUER, null))).toBeNull();
  });

  it("a provider that can't tell (its store failing) leaves the original error alone", async () => {
    const { provider } = setup(SIGNED_IN);
    const broken = { ...provider, signInNeededBy: async () => { throw new Error("db down"); } };
    expect(await asNeedsSignIn(broken, new UnauthorizedError("401"))).toBeNull();
  });

  it("maps through the provider", async () => {
    const { provider } = setup(SIGNED_IN);
    expect(await asNeedsSignIn(provider, new UnauthorizedError("401"))).toMatchObject({ reason: "lapsed" });
  });
});
