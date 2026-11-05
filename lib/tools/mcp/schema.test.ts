// @vitest-environment node
//
// WHAT LEN MAY BE GIVEN (spec local 2026-11-04-herramientas-hechas-por-len, §4.7, Review Focus 1): a tool's operations go
// into the tool list of every turn of the person, in every project — so one the provider would reject must be left out
// at install, with a problem Len can fix, never a 400 that breaks all of them.
import { describe, expect, it } from "vitest";

import { checkTools, MCP_DESCRIPTION_MAX, MCP_MAX_TOOLS, MCP_SCHEMA_MAX_BYTES } from "./schema";

const add = { name: "add", title: "Addition Tool", description: "Add two numbers together", inputSchema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } };

describe("checkTools", () => {
  it("a good tool passes, without $schema, its title before its description", () => {
    const r = checkTools("calc", [add]);
    expect(r.problems).toEqual([]);
    expect(r.tools).toEqual([
      { name: "add", description: "Addition Tool — Add two numbers together", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } },
    ]);
  });

  it("no title: the description alone; neither: the name", () => {
    expect(checkTools("calc", [{ name: "add", description: "Adds", inputSchema: { type: "object" } }]).tools[0]!.description).toBe("Adds");
    expect(checkTools("calc", [{ name: "add", inputSchema: { type: "object" } }]).tools[0]!.description).toBe("add");
  });

  it("a name the provider can't take, or too long once prefixed, is left out and named", () => {
    const r = checkTools("calc", [
      { ...add, name: "add numbers" },
      { ...add, name: "x".repeat(60) },
    ]);
    expect(r.tools).toEqual([]);
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0]).toContain("add numbers");
  });

  it("a root that isn't an object, a $ref, or a schema over 16 KB is left out", () => {
    const r = checkTools("calc", [
      { ...add, name: "a", inputSchema: { type: "string" } },
      { ...add, name: "b", inputSchema: { type: "object", properties: { x: { $ref: "#/definitions/x" } } } },
      { ...add, name: "c", inputSchema: { type: "object", description: "x".repeat(MCP_SCHEMA_MAX_BYTES) } },
    ]);
    expect(r.tools).toEqual([]);
    expect(r.problems.map((p) => p.slice(0, 1))).toEqual(["a", "b", "c"]);
  });

  it("past 32 tools the rest are left out, with one problem", () => {
    const many = Array.from({ length: MCP_MAX_TOOLS + 3 }, (_, i) => ({ ...add, name: `op${i}` }));
    const r = checkTools("calc", many);
    expect(r.tools).toHaveLength(MCP_MAX_TOOLS);
    expect(r.problems).toHaveLength(1);
  });

  it("a description is cut at 2 KB", () => {
    const r = checkTools("calc", [{ ...add, title: undefined, description: "d".repeat(MCP_DESCRIPTION_MAX + 50) }]);
    expect(r.tools[0]!.description).toHaveLength(MCP_DESCRIPTION_MAX);
  });

  it("two tools with the same name: the first one stays", () => {
    const r = checkTools("calc", [add, { ...add, description: "again" }]);
    expect(r.tools).toHaveLength(1);
    expect(r.problems).toHaveLength(1);
  });
});
