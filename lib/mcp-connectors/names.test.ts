import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { publicToolName, reviewTools } from "./names";

const sha12 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const obj = { type: "object", properties: {} };

// DeepSeek's v1 naming contract (packages/mcp/mcp-client, archived note 2026-07-07): pinned.
describe("publicToolName", () => {
  it("clean name passes through", () => {
    expect(publicToolName("github", "create_issue")).toBe("mcp__github__create_issue");
  });

  it("dots become underscores plus hash", () => {
    expect(publicToolName("web", "a.b")).toBe(`mcp__web__a_b_${sha12("web\0a.b")}`);
  });

  it("long names are cut to 64 with the hash", () => {
    const raw = "x".repeat(80);
    const name = publicToolName("srv", raw);
    expect(name).toHaveLength(64);
    expect(name.endsWith(`_${sha12(`srv\0${raw}`)}`)).toBe(true);
    expect(name.startsWith("mcp__srv__xxx")).toBe(true);
  });

  it("two raw names that normalize alike stay distinct", () => {
    expect(publicToolName("s", "a.b")).not.toBe(publicToolName("s", "a_b"));
  });
});

describe("reviewTools", () => {
  it("keeps good tools with their public name", () => {
    const r = reviewTools("gh", [{ name: "search", description: "Search code", inputSchema: obj }]);
    expect(r.problems).toEqual([]);
    expect(r.tools).toEqual([{ publicName: "mcp__gh__search", rawName: "search", description: "Search code", inputSchema: obj }]);
  });

  it("duplicate raw name refuses the list", () => {
    const r = reviewTools("gh", [
      { name: "search", inputSchema: obj },
      { name: "search", inputSchema: obj },
    ]);
    expect(r.tools).toEqual([]);
    expect(r.problems).toEqual(['duplicate tool name "search": the list was refused']);
  });

  it("$ref schema left out with a problem", () => {
    const r = reviewTools("gh", [{ name: "x", inputSchema: { type: "object", properties: { a: { $ref: "#/defs/a" } } } }]);
    expect(r.tools).toEqual([]);
    expect(r.problems[0]).toMatch(/^x: .*\$ref/);
  });

  it("schema over 16 KB left out", () => {
    const big = { type: "object", description: "y".repeat(17_000) };
    const r = reviewTools("gh", [{ name: "x", inputSchema: big }]);
    expect(r.tools).toEqual([]);
    expect(r.problems[0]).toMatch(/^x: .*16384 bytes/);
  });

  it("a name that needs normalizing is kept under its normalized name", () => {
    const r = reviewTools("web", [{ name: "a.b", inputSchema: obj }]);
    expect(r.tools[0]?.publicName).toBe(publicToolName("web", "a.b"));
    expect(r.tools[0]?.rawName).toBe("a.b");
  });
});
