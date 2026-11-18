// Which OAuth client OpenLen uses for a connector (spec local 2026-11-17-oauth-de-conectores-mcp, §5.2) and the switch
// that turns the whole OAuth path on or off. Pure: no database, no network.
import { describe, expect, it } from "vitest";

import type { McpServerEntry } from "../config";
import { callbackUrl, clientMetadata, clientMetadataUrl, openLenClientFor, preRegisteredClient } from "./clients";
import { oauthEnabled } from "./enabled";

const GOOGLE = "https://accounts.google.com";
const GOOGLE_ENV = { OPENLEN_MCP_GOOGLE_CLIENT_ID: "openlen-google-id", OPENLEN_MCP_GOOGLE_CLIENT_SECRET: "openlen-google-secret" };
const NO_SECRETS: ReadonlyMap<string, string> = new Map();

function entry(oauth?: McpServerEntry["oauth"]): McpServerEntry {
  return {
    transport: "streamable-http",
    url: "https://calendar.example/mcp",
    headers: {},
    ...(oauth && { oauth }),
    enabled: true,
    startupTimeoutMs: 30_000,
    toolCallTimeoutMs: 60_000,
  };
}

describe("oauthEnabled", () => {
  it("is on unless the literal «0» turns it off", () => {
    expect(oauthEnabled({})).toBe(true);
    expect(oauthEnabled({ OPENLEN_MCP_OAUTH: "1" })).toBe(true);
    expect(oauthEnabled({ OPENLEN_MCP_OAUTH: "" })).toBe(true);
    expect(oauthEnabled({ OPENLEN_MCP_OAUTH: "false" })).toBe(true);
    expect(oauthEnabled({ OPENLEN_MCP_OAUTH: "0" })).toBe(false);
  });

  it("is off whenever the connectors are off", () => {
    expect(oauthEnabled({ OPENLEN_MCP: "0" })).toBe(false);
    expect(oauthEnabled({ OPENLEN_MCP: "0", OPENLEN_MCP_OAUTH: "1" })).toBe(false);
  });
});

describe("openLenClientFor", () => {
  it("is Google's client for Google's issuer, when both variables are set", () => {
    expect(openLenClientFor(GOOGLE, GOOGLE_ENV)).toEqual({ client_id: "openlen-google-id", client_secret: "openlen-google-secret" });
  });

  it("is null without the variables, or with one of them empty", () => {
    expect(openLenClientFor(GOOGLE, {})).toBeNull();
    expect(openLenClientFor(GOOGLE, { OPENLEN_MCP_GOOGLE_CLIENT_ID: "id" })).toBeNull();
    expect(openLenClientFor(GOOGLE, { OPENLEN_MCP_GOOGLE_CLIENT_SECRET: "secret" })).toBeNull();
    expect(openLenClientFor(GOOGLE, { ...GOOGLE_ENV, OPENLEN_MCP_GOOGLE_CLIENT_ID: "" })).toBeNull();
    expect(openLenClientFor(GOOGLE, { ...GOOGLE_ENV, OPENLEN_MCP_GOOGLE_CLIENT_SECRET: "" })).toBeNull();
  });

  it("is null for any other issuer, and for Google's only exactly spelled", () => {
    expect(openLenClientFor("https://auth.example.com", GOOGLE_ENV)).toBeNull();
    expect(openLenClientFor("https://accounts.google.com/", GOOGLE_ENV)).toBeNull();
    expect(openLenClientFor("http://accounts.google.com", GOOGLE_ENV)).toBeNull();
    expect(openLenClientFor("https://evil.example/https://accounts.google.com", GOOGLE_ENV)).toBeNull();
  });
});

describe("preRegisteredClient", () => {
  it("is the entry's own client first, with its secret resolved from the person's credentials", () => {
    const e = entry({ clientId: "mine", clientSecret: "${credential:CAL_SECRET}", authorizationServer: [GOOGLE] });
    const secrets = new Map([["CAL_SECRET", "s3cret"]]);
    expect(preRegisteredClient(e, GOOGLE, secrets, GOOGLE_ENV)).toEqual({ client_id: "mine", client_secret: "s3cret" });
  });

  it("is a public client when the entry has a clientId and no secret", () => {
    const e = entry({ clientId: "mine" });
    expect(preRegisteredClient(e, "https://auth.example.com", NO_SECRETS, {})).toEqual({ client_id: "mine" });
  });

  it("lets the entry's clientId win over OpenLen's client for Google", () => {
    const e = entry({ clientId: "mine" });
    expect(preRegisteredClient(e, GOOGLE, NO_SECRETS, GOOGLE_ENV)).toEqual({ client_id: "mine" });
  });

  it("uses the entry's clientId whatever the issuer is", () => {
    const e = entry({ clientId: "mine", clientSecret: "${credential:CAL_SECRET}", authorizationServer: ["https://auth.example.com"] });
    const secrets = new Map([["CAL_SECRET", "s3cret"]]);
    expect(preRegisteredClient(e, "https://other-issuer.example", secrets, {})).toEqual({ client_id: "mine", client_secret: "s3cret" });
  });

  // A confidential client with its secret missing would be sent to the token endpoint as a public one and fail there
  // with an error that blames the provider. The caller reports the missing credential by name instead, so no step
  // below this one may quietly stand in for it — not even OpenLen's own client for Google.
  it("is null when the entry's secret has no value, and never falls back to another client", () => {
    const e = entry({ clientId: "mine", clientSecret: "${credential:CAL_SECRET}", authorizationServer: [GOOGLE] });
    expect(preRegisteredClient(e, GOOGLE, NO_SECRETS, GOOGLE_ENV)).toBeNull();
    expect(preRegisteredClient(e, GOOGLE, new Map([["OTHER", "x"]]), GOOGLE_ENV)).toBeNull();
    expect(preRegisteredClient(e, GOOGLE, new Map([["CAL_SECRET", ""]]), GOOGLE_ENV)).toBeNull();
  });

  it("is OpenLen's client for that issuer when the entry names none", () => {
    expect(preRegisteredClient(entry(), GOOGLE, NO_SECRETS, GOOGLE_ENV)).toEqual({ client_id: "openlen-google-id", client_secret: "openlen-google-secret" });
    // An oauth block that only tunes the scope doesn't name a client either.
    expect(preRegisteredClient(entry({ scope: "calendar.readonly" }), GOOGLE, NO_SECRETS, GOOGLE_ENV)).toEqual({
      client_id: "openlen-google-id",
      client_secret: "openlen-google-secret",
    });
  });

  it("is null when nobody has a client for that issuer (the SDK goes on with CIMD and dynamic registration)", () => {
    expect(preRegisteredClient(entry(), GOOGLE, NO_SECRETS, {})).toBeNull();
    expect(preRegisteredClient(entry(), "https://auth.example.com", NO_SECRETS, GOOGLE_ENV)).toBeNull();
    expect(preRegisteredClient(entry({ scope: "x" }), "https://auth.example.com", NO_SECRETS, GOOGLE_ENV)).toBeNull();
  });
});

describe("what OpenLen tells the provider about itself", () => {
  it("has one return address, with no locale", () => {
    expect(callbackUrl("https://openlen.com")).toBe("https://openlen.com/api/mcp-connectors/oauth/callback");
    expect(clientMetadata("https://openlen.com").redirect_uris).toEqual(["https://openlen.com/api/mcp-connectors/oauth/callback"]);
  });

  it("serves its client metadata document at a fixed path", () => {
    expect(clientMetadataUrl("https://openlen.com")).toBe("https://openlen.com/oauth/mcp-client.json");
  });

  it("doesn't double the slash when the site URL ends with one", () => {
    expect(callbackUrl("https://openlen.com/")).toBe("https://openlen.com/api/mcp-connectors/oauth/callback");
    expect(clientMetadataUrl("https://openlen.com/")).toBe("https://openlen.com/oauth/mcp-client.json");
  });

  it("is a public client with PKCE, named OpenLen", () => {
    expect(clientMetadata("https://openlen.com")).toEqual({
      client_name: "OpenLen",
      redirect_uris: ["https://openlen.com/api/mcp-connectors/oauth/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });
});
