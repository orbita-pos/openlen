import { describe, expect, it } from "vitest";

import { connectorsEnabled } from "./enabled";
import { credentialRefs, credentialRefsOf, makeRedactor, resolveEntry } from "./templates";

const entry = {
  transport: "streamable-http" as const,
  url: "https://x.example.com/${credential:A}/mcp",
  headers: { Authorization: "Bearer ${credential:B}" },
  enabled: true,
  startupTimeoutMs: 30000,
  toolCallTimeoutMs: 60000,
};

describe("credential references", () => {
  it("lists the names, sorted and unique", () => {
    expect(credentialRefs("${credential:Z} ${credential:A} ${credential:Z}")).toEqual(["A", "Z"]);
    expect(credentialRefsOf(entry)).toEqual(["A", "B"]);
  });
});

describe("resolveEntry", () => {
  it("resolves and reports missing", () => {
    expect(resolveEntry(entry, new Map([["A", "aa"]]))).toEqual({ ok: false, missing: ["B"] });
    expect(resolveEntry(entry, new Map([["A", "aa"], ["B", "bb"]]))).toEqual({
      ok: true,
      url: "https://x.example.com/aa/mcp",
      headers: { Authorization: "Bearer bb" },
      resolved: ["aa", "bb"],
    });
  });
});

describe("makeRedactor", () => {
  it("redactor replaces plain and URL-encoded forms", () => {
    const redact = makeRedactor(["a b/c"]);
    expect(redact("x a b/c y a%20b%2Fc z")).toBe("x [redacted] y [redacted] z");
  });

  it("redactor with no values is identity", () => {
    expect(makeRedactor([])("same text")).toBe("same text");
  });
});

describe("connectorsEnabled", () => {
  it("is on unless OPENLEN_MCP is 0", () => {
    expect(connectorsEnabled({})).toBe(true);
    expect(connectorsEnabled({ OPENLEN_MCP: "0" })).toBe(false);
  });
});
