import { describe, expect, it } from "vitest";

import { entryFingerprint, MCP_MAX_SERVERS, parseMcpConfig, serializeMcpConfig } from "./config";

const none = { reservedServerNames: new Set<string>() };
const one = (entry: Record<string, unknown>, name = "a") => JSON.stringify({ servers: { [name]: entry } });
const base = { transport: "streamable-http", url: "https://mcp.example.com/mcp" };
const errorOf = (text: string, opts = none) => {
  const r = parseMcpConfig(text, opts);
  if (r.ok) throw new Error("expected a refusal");
  return r.error;
};

describe("parseMcpConfig", () => {
  it("accepts DeepSeek's minimal entry and fills defaults", () => {
    const r = parseMcpConfig(
      JSON.stringify({ servers: { notion: { ...base, headers: { Authorization: "Bearer ${credential:NOTION_TOKEN}" } } } }),
      none,
    );
    expect(r).toEqual({
      ok: true,
      config: {
        servers: {
          notion: {
            transport: "streamable-http",
            url: "https://mcp.example.com/mcp",
            headers: { Authorization: "Bearer ${credential:NOTION_TOKEN}" },
            enabled: true,
            startupTimeoutMs: 30000,
            toolCallTimeoutMs: 60000,
          },
        },
      },
    });
  });

  it("refuses text that isn't JSON", () => {
    expect(errorOf("{ nope")).toMatch(/^mcp\.json: /);
  });

  it("refuses a bad server name", () => {
    expect(errorOf(one(base, "no spaces"))).toMatch(/^servers\.no spaces: /);
  });

  it(`refuses more than ${MCP_MAX_SERVERS} servers`, () => {
    const servers = Object.fromEntries(Array.from({ length: MCP_MAX_SERVERS + 1 }, (_, i) => [`s${i}`, base]));
    expect(errorOf(JSON.stringify({ servers }))).toMatch(/^servers: at most 10/);
  });

  it("refuses stdio for now", () => {
    expect(errorOf(one({ transport: "stdio", command: "npx" }))).toContain("stdio isn't available yet");
  });

  it("refuses a url that isn't https", () => {
    expect(errorOf(one({ ...base, url: "http://x.com/mcp" }))).toBe("servers.a.url: must be an https:// URL");
  });

  it("refuses a stdio field on streamable-http", () => {
    expect(errorOf(one({ ...base, command: "npx" }))).toMatch(/^servers\.a\.command: not a field of streamable-http/);
  });

  it("refuses a malformed credential reference", () => {
    expect(errorOf(one({ ...base, headers: { Authorization: "Bearer ${credential:lower}" } }))).toMatch(
      /^servers\.a\.headers\.Authorization: malformed credential reference/,
    );
  });

  it("refuses a key written in clear in a sensitive header", () => {
    expect(errorOf(one({ ...base, headers: { Authorization: "Bearer ntn_abc123" } }))).toMatch(
      /^servers\.a\.headers\.Authorization: write the key as \$\{credential:NAME\}/,
    );
  });

  it("accepts templates in sensitive headers", () => {
    expect(parseMcpConfig(one({ ...base, headers: { "X-Api-Key": "${credential:K}" } }), none).ok).toBe(true);
    expect(parseMcpConfig(one({ ...base, headers: { Authorization: "Bearer ${credential:K}" } }), none).ok).toBe(true);
  });

  it("refuses digits around a template in a sensitive header", () => {
    expect(errorOf(one({ ...base, headers: { "X-Api-Key": "abc123${credential:K}" } }))).toMatch(/^servers\.a\.headers\.X-Api-Key: /);
  });

  it("accepts plain text in a header that isn't sensitive", () => {
    expect(parseMcpConfig(one({ ...base, headers: { "X-Workspace": "acme" } }), none).ok).toBe(true);
  });

  it("refuses a secret in the url", () => {
    expect(errorOf(one({ ...base, url: "https://x.com/mcp?key=sk-ant-abcdefghijklmnopqrstuvwxyz" }))).toMatch(/^servers\.a\.url: /);
  });

  it("🔴 refuses __ in a server name: mcp__a__b__x could then name two different tools", () => {
    expect(errorOf(one(base, "a__b"))).toMatch(/^servers\.a__b: .*__/);
    expect(parseMcpConfig(one(base, "a_b"), none).ok).toBe(true);
  });

  it("refuses the name of an installed tool", () => {
    expect(errorOf(one(base, "mytool"), { reservedServerNames: new Set(["mytool"]) })).toBe(
      "servers.mytool: an installed tool already uses this name",
    );
  });

  it("refuses a timeout out of range", () => {
    expect(errorOf(one({ ...base, toolCallTimeoutMs: 500 }))).toMatch(/^servers\.a\.toolCallTimeoutMs: /);
  });

  it("refuses unknown top-level keys", () => {
    expect(errorOf(JSON.stringify({ servers: {}, mcpServers: {} }))).toMatch(/^mcpServers: /);
  });
});

describe("entryFingerprint", () => {
  const parse = (entry: Record<string, unknown>) => {
    const r = parseMcpConfig(one(entry), none);
    if (!r.ok) throw new Error(r.error);
    return r.config.servers.a!;
  };

  it("fingerprint ignores enabled and timeouts but not headers", () => {
    const a = parse({ ...base, headers: { A: "1", B: "2" } });
    expect(entryFingerprint(parse({ ...base, headers: { B: "2", A: "1" }, enabled: false, toolCallTimeoutMs: 5000 }))).toBe(entryFingerprint(a));
    expect(entryFingerprint(parse({ ...base, headers: { A: "1", B: "3" } }))).not.toBe(entryFingerprint(a));
    expect(entryFingerprint(parse({ ...base, url: "https://other.example.com/mcp", headers: { A: "1", B: "2" } }))).not.toBe(entryFingerprint(a));
  });
});

// The oauth block (spec local 2026-11-17-oauth-de-conectores-mcp, §5.1): Claude Code's field names and rules.
describe("oauth block", () => {
  const cal = { transport: "streamable-http", url: "https://calendarmcp.googleapis.com/mcp/v1" };
  const calWith = (oauth: unknown) => one({ ...cal, oauth }, "cal");
  const google = ["https://accounts.google.com"];
  const parseCal = (oauth: unknown) => {
    const r = parseMcpConfig(calWith(oauth), none);
    if (!r.ok) throw new Error(r.error);
    return r.config.servers.cal!;
  };

  it("accepts scope only", () => {
    const r = parseMcpConfig(
      '{"servers":{"cal":{"transport":"streamable-http","url":"https://calendarmcp.googleapis.com/mcp/v1","oauth":{"scope":"https://www.googleapis.com/auth/calendar"}}}}',
      none,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.config.servers.cal!.oauth).toEqual({ scope: "https://www.googleapis.com/auth/calendar" });
  });

  it("accepts a registered client with its secret as a credential reference", () => {
    const entry = parseCal({
      clientId: "123.apps.googleusercontent.com",
      clientSecret: "${credential:CAL_SECRET}",
      scope: "https://www.googleapis.com/auth/calendar",
      authServerMetadataUrl: "https://accounts.google.com/.well-known/openid-configuration",
      authorizationServer: google,
    });
    expect(entry.oauth).toEqual({
      clientId: "123.apps.googleusercontent.com",
      clientSecret: "${credential:CAL_SECRET}",
      scope: "https://www.googleapis.com/auth/calendar",
      authServerMetadataUrl: "https://accounts.google.com/.well-known/openid-configuration",
      authorizationServer: google,
    });
  });

  it("an entry without oauth has no oauth key, and an empty block is kept", () => {
    expect("oauth" in parseCal(undefined)).toBe(false);
    expect(parseCal({}).oauth).toEqual({});
  });

  it("survives a write and a read", () => {
    const entry = parseCal({ clientId: "id", authorizationServer: google, scope: "s" });
    const again = parseMcpConfig(serializeMcpConfig({ servers: { cal: entry } }), none);
    expect(again).toEqual({ ok: true, config: { servers: { cal: entry } } });
  });

  it("oauth must be an object", () => {
    expect(errorOf(calWith("yes"))).toBe("servers.cal.oauth: must be an object");
    expect(errorOf(calWith(null))).toBe("servers.cal.oauth: must be an object");
    expect(errorOf(calWith(["scope"]))).toBe("servers.cal.oauth: must be an object");
  });

  it("clientSecret needs clientId", () => {
    expect(errorOf(calWith({ clientSecret: "${credential:S}", authorizationServer: google }))).toBe(
      "servers.cal.oauth.clientId: clientId is required when clientSecret/authServerMetadataUrl/authorizationServer is set",
    );
  });

  it("authServerMetadataUrl and authorizationServer need clientId too", () => {
    const needs = "servers.cal.oauth.clientId: clientId is required when clientSecret/authServerMetadataUrl/authorizationServer is set";
    expect(errorOf(calWith({ authServerMetadataUrl: "https://accounts.google.com/.well-known/openid-configuration" }))).toBe(needs);
    expect(errorOf(calWith({ authorizationServer: google }))).toBe(needs);
  });

  it("clientSecret needs authorizationServer", () => {
    expect(errorOf(calWith({ clientId: "id", clientSecret: "${credential:S}" }))).toBe(
      'servers.cal.oauth.authorizationServer: required when a client secret is configured (for a Google client use ["https://accounts.google.com"])',
    );
  });

  it("clientSecret only as a credential reference", () => {
    const only = "servers.cal.oauth.clientSecret: write the secret as ${credential:NAME}; the person types its value in OpenLen";
    expect(errorOf(calWith({ clientId: "id", clientSecret: "abc", authorizationServer: google }))).toBe(only);
    expect(errorOf(calWith({ clientSecret: "abc" }))).toBe(only);
    expect(errorOf(calWith({ clientId: "id", clientSecret: "", authorizationServer: google }))).toBe(only);
  });

  it("🔴 clientSecret is exactly one reference: it goes to the token endpoint as is, with nothing around it", () => {
    const only = "servers.cal.oauth.clientSecret: write the secret as ${credential:NAME}; the person types its value in OpenLen";
    for (const secret of ["Bearer ${credential:X}", "abc${credential:X}", "${credential:A}${credential:B}", "${credential:X} ", " ${credential:X}", "${credential:X}-", "${credential:A} ${credential:B}"]) {
      expect(errorOf(calWith({ clientId: "id", clientSecret: secret, authorizationServer: google })), JSON.stringify(secret)).toBe(only);
    }
    expect(parseCal({ clientId: "id", clientSecret: "${credential:CAL_SECRET_2}", authorizationServer: google }).oauth?.clientSecret).toBe("${credential:CAL_SECRET_2}");
  });

  it("clientSecret refuses a malformed reference and a key that looks real", () => {
    expect(errorOf(calWith({ clientId: "id", clientSecret: "${credential:lower}", authorizationServer: google }))).toMatch(
      /^servers\.cal\.oauth\.clientSecret: malformed credential reference/,
    );
    expect(errorOf(calWith({ clientId: "id", clientSecret: "sk-ant-abcdefghijklmnopqrstuvwxyz", authorizationServer: google }))).toMatch(
      /^servers\.cal\.oauth\.clientSecret: it looks like it holds a API key; write the key as \$\{credential:NAME\}/,
    );
  });

  it("authServerMetadataUrl must be https", () => {
    expect(errorOf(calWith({ clientId: "id", authServerMetadataUrl: "http://accounts.google.com/.well-known/openid-configuration" }))).toBe(
      "servers.cal.oauth.authServerMetadataUrl: must use https://",
    );
    expect(errorOf(calWith({ clientId: "id", authServerMetadataUrl: "not a url" }))).toBe("servers.cal.oauth.authServerMetadataUrl: must use https://");
    expect(errorOf(calWith({ clientId: "id", authServerMetadataUrl: 5 }))).toBe("servers.cal.oauth.authServerMetadataUrl: must use https://");
  });

  it("authorizationServer is a non-empty list of https URLs", () => {
    const at = "servers.cal.oauth.authorizationServer";
    expect(errorOf(calWith({ clientId: "id", authorizationServer: [] }))).toBe(`${at}: must be a non-empty list of https:// URLs`);
    expect(errorOf(calWith({ clientId: "id", authorizationServer: "https://accounts.google.com" }))).toBe(`${at}: must be a non-empty list of https:// URLs`);
    expect(errorOf(calWith({ clientId: "id", authorizationServer: ["https://accounts.google.com", "http://other.example.com"] }))).toBe(
      `${at}[1]: must use https://`,
    );
    expect(errorOf(calWith({ clientId: "id", authorizationServer: [7] }))).toBe(`${at}[0]: must use https://`);
  });

  it("the two URL fields can't carry a key either (findSecret runs over them)", () => {
    const key = "sk-ant-abcdefghijklmnopqrstuvwxyz";
    expect(errorOf(calWith({ clientId: "id", authServerMetadataUrl: `https://accounts.google.com/.well-known/openid-configuration?key=${key}` }))).toBe(
      "servers.cal.oauth.authServerMetadataUrl: it looks like it holds a API key; a URL here can't carry a key",
    );
    expect(errorOf(calWith({ clientId: "id", authorizationServer: ["https://accounts.google.com", `https://issuer.example.com/?k=${key}`] }))).toBe(
      "servers.cal.oauth.authorizationServer[1]: it looks like it holds a API key; a URL here can't carry a key",
    );
  });

  it("a plain string field must be a non-empty string", () => {
    expect(errorOf(calWith({ clientId: 7 }))).toBe("servers.cal.oauth.clientId: must be a non-empty string");
    expect(errorOf(calWith({ clientId: "" }))).toBe("servers.cal.oauth.clientId: must be a non-empty string");
    expect(errorOf(calWith({ scope: false }))).toBe("servers.cal.oauth.scope: must be a non-empty string");
    expect(errorOf(calWith({ scope: "" }))).toBe("servers.cal.oauth.scope: must be a non-empty string");
  });

  it("unknown oauth field", () => {
    expect(errorOf(calWith({ callbackPort: 8080 }))).toBe("servers.cal.oauth.callbackPort: unknown field");
  });

  it("oauth changes the fingerprint", () => {
    const withScope = (scope: string) => parseCal({ scope });
    expect(entryFingerprint(withScope("a"))).not.toBe(entryFingerprint(withScope("b")));
    expect(entryFingerprint(withScope("a"))).not.toBe(entryFingerprint(parseCal(undefined)));
    expect(entryFingerprint(parseCal({}))).not.toBe(entryFingerprint(parseCal(undefined)));
    const registered = (extra: Record<string, unknown>) => parseCal({ clientId: "id", authorizationServer: google, ...extra });
    expect(entryFingerprint(registered({ authorizationServer: ["https://other.example.com"] }))).not.toBe(entryFingerprint(registered({})));
    expect(entryFingerprint(registered({ clientSecret: "${credential:A}" }))).not.toBe(entryFingerprint(registered({ clientSecret: "${credential:B}" })));
  });

  it("the order of the keys in oauth does not change the fingerprint", () => {
    const a = parseCal({ clientId: "id", scope: "s", authorizationServer: google });
    const b = parseCal({ authorizationServer: google, scope: "s", clientId: "id" });
    expect(entryFingerprint(a)).toBe(entryFingerprint(b));
  });

  it("🔴 an entry without oauth keeps today's fingerprint: approvals already stored stay valid", () => {
    const parse = (entry: Record<string, unknown>) => {
      const r = parseMcpConfig(one(entry), none);
      if (!r.ok) throw new Error(r.error);
      return r.config.servers.a!;
    };
    // sha256 of JSON.stringify({ url, headers }), computed before the oauth block existed.
    expect(entryFingerprint(parse({ ...base, headers: { B: "2", A: "1" } }))).toBe("275234381e7465744442317dc7a573efcc06fe4bf034140045b9b041f1ef926b");
    expect(entryFingerprint(parse(base))).toBe("9d5c9f476cae8744ee203818c02c61f1abd6fde516db4527f7a829260c5edf3e");
  });
});

describe("serializeMcpConfig", () => {
  it("writes two-space JSON with a final newline", () => {
    expect(serializeMcpConfig({ servers: {} })).toBe('{\n  "servers": {}\n}\n');
  });
});
