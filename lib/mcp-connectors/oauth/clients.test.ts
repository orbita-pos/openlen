// Which OAuth client OpenLen uses for a connector (spec local 2026-11-17-oauth-de-conectores-mcp, §5.2) and the switch
// that turns the whole OAuth path on or off. Pure: no database, no network.
import { describe, expect, it } from "vitest";

import type { McpServerEntry } from "../config";
import { callbackUrl, clientMetadata, clientMetadataUrl, isClientRefusal, openLenClientFor, preRegisteredClient } from "./clients";
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

  it("uses the entry's clientId whatever the issuer is, when the entry doesn't list the issuers it is for", () => {
    const e = entry({ clientId: "mine" });
    expect(preRegisteredClient(e, "https://other-issuer.example", NO_SECRETS, {})).toEqual({ client_id: "mine" });
  });

  describe("the issuers the client is for (oauth.authorizationServer)", () => {
    const LISTED = "https://auth.example.com";

    it("accepts an issuer inside the list, with or without a secret", () => {
      const secrets = new Map([["CAL_SECRET", "s3cret"]]);
      const confidential = entry({ clientId: "mine", clientSecret: "${credential:CAL_SECRET}", authorizationServer: [LISTED, GOOGLE] });
      expect(preRegisteredClient(confidential, LISTED, secrets, {})).toEqual({ client_id: "mine", client_secret: "s3cret" });
      expect(preRegisteredClient(confidential, GOOGLE, secrets, {})).toEqual({ client_id: "mine", client_secret: "s3cret" });
      const open = entry({ clientId: "mine", authorizationServer: [LISTED] });
      expect(preRegisteredClient(open, LISTED, NO_SECRETS, {})).toEqual({ client_id: "mine" });
    });

    it("refuses an issuer outside the list for a client with a secret, and doesn't hand the secret over", () => {
      const e = entry({ clientId: "mine", clientSecret: "${credential:CAL_SECRET}", authorizationServer: [LISTED] });
      const secrets = new Map([["CAL_SECRET", "s3cret-value-123"]]);
      const result = preRegisteredClient(e, "https://evil.example", secrets, GOOGLE_ENV);
      expect(result).toEqual({ refused: "issuer_not_allowed", detail: "https://evil.example is not in oauth.authorizationServer" });
      expect(JSON.stringify(result)).not.toContain("s3cret-value-123");
    });

    it("refuses an issuer outside the list for a public client too", () => {
      const e = entry({ clientId: "mine", authorizationServer: [LISTED] });
      expect(preRegisteredClient(e, "https://evil.example", NO_SECRETS, {})).toEqual({
        refused: "issuer_not_allowed",
        detail: "https://evil.example is not in oauth.authorizationServer",
      });
    });

    it("compares exactly, as an issuer is an identity (no trailing slash, scheme, case or prefix tolerance)", () => {
      const e = entry({ clientId: "mine", authorizationServer: [LISTED] });
      for (const issuer of [`${LISTED}/`, "http://auth.example.com", `${LISTED}/tenant`, "https://AUTH.example.com", "https://auth.example.com.evil.example"]) {
        expect(preRegisteredClient(e, issuer, NO_SECRETS, {})).toMatchObject({ refused: "issuer_not_allowed" });
      }
    });

    it("never stands OpenLen's client in for a refused issuer", () => {
      const e = entry({ clientId: "mine", authorizationServer: [LISTED] });
      expect(preRegisteredClient(e, GOOGLE, NO_SECRETS, GOOGLE_ENV)).toMatchObject({ refused: "issuer_not_allowed" });
    });

    it("checks the issuer before the secret: a refused issuer says so even when the secret is missing", () => {
      const e = entry({ clientId: "mine", clientSecret: "${credential:CAL_SECRET}", authorizationServer: [LISTED] });
      expect(preRegisteredClient(e, "https://evil.example", NO_SECRETS, {})).toMatchObject({ refused: "issuer_not_allowed" });
    });
  });

  // A confidential client with its secret missing would be sent to the token endpoint as a public one and fail there
  // with an error that blames the provider, and a bare null would let the SDK carry on with CIMD or dynamic
  // registration as if the entry named no client. So it is a refusal that names the credential, and no step below this
  // one stands in for it — not even OpenLen's own client for Google.
  describe("a secret the person hasn't typed yet", () => {
    const e = entry({ clientId: "mine", clientSecret: "${credential:CAL_SECRET}", authorizationServer: [GOOGLE] });

    it("is refused, naming the credential", () => {
      expect(preRegisteredClient(e, GOOGLE, NO_SECRETS, GOOGLE_ENV)).toEqual({ refused: "missing_secret", detail: "CAL_SECRET" });
    });

    it("is refused when the map only has other credentials, or an empty value", () => {
      expect(preRegisteredClient(e, GOOGLE, new Map([["OTHER", "x"]]), GOOGLE_ENV)).toEqual({ refused: "missing_secret", detail: "CAL_SECRET" });
      expect(preRegisteredClient(e, GOOGLE, new Map([["CAL_SECRET", ""]]), GOOGLE_ENV)).toEqual({ refused: "missing_secret", detail: "CAL_SECRET" });
    });

    it("never carries another credential's value in its detail", () => {
      const result = preRegisteredClient(e, GOOGLE, new Map([["OTHER", "other-secret-value-456"]]), GOOGLE_ENV);
      expect(isClientRefusal(result)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("other-secret-value-456");
    });

    it("is refused without an authorizationServer list too", () => {
      const open = entry({ clientId: "mine", clientSecret: "${credential:CAL_SECRET}" });
      expect(preRegisteredClient(open, "https://auth.example.com", NO_SECRETS, {})).toEqual({ refused: "missing_secret", detail: "CAL_SECRET" });
    });
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

describe("isClientRefusal", () => {
  it("tells a refusal from a client and from nothing", () => {
    expect(isClientRefusal({ refused: "missing_secret", detail: "CAL_SECRET" })).toBe(true);
    expect(isClientRefusal({ refused: "issuer_not_allowed", detail: "x" })).toBe(true);
    expect(isClientRefusal({ client_id: "mine" })).toBe(false);
    expect(isClientRefusal({ client_id: "mine", client_secret: "s" })).toBe(false);
    expect(isClientRefusal(null)).toBe(false);
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
