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

describe("serializeMcpConfig", () => {
  it("writes two-space JSON with a final newline", () => {
    expect(serializeMcpConfig({ servers: {} })).toBe('{\n  "servers": {}\n}\n');
  });
});
