// @vitest-environment node
//
// THE QUERY OF AN AGENT'S TOOL (spec local 2026-11-22-herramienta-dentro-del-agente, §3): `where` / `orderBy` / `limit`
// over the documents of one collection, as the `query` of Claude's artifact database. Pure: no database, no clock.
import { describe, expect, it } from "vitest";

import { AGENT_TOOL_QUERY_LIMIT_MAX } from "./limits";
import { runQuery } from "./query";
import type { AgentToolDoc } from "./store";

const AT = new Date("2026-11-22T10:00:00Z");
const doc = (docId: string, data: unknown, collection = "lessons"): AgentToolDoc => ({ collection, docId, data, updatedAt: AT, updatedBy: "agent" });
const ids = (docs: readonly AgentToolDoc[]) => docs.map((d) => d.docId);

const LESSONS = [
  doc("l1", { title: "Greetings", stats: { score: 90, tries: 2 }, done: true, level: "a1" }),
  doc("l2", { title: "Numbers", stats: { score: 60, tries: 5 }, done: false, level: "a1" }),
  doc("l3", { title: "Food", stats: { score: 75, tries: 1 }, done: true, level: "a2" }),
  doc("l4", { title: "Travel", done: false, level: "a2" }),
];

describe("where", () => {
  it("== matches a field, a dotted path into nested data, and a boolean", () => {
    expect(ids(runQuery(LESSONS, { where: [{ field: "level", op: "==", value: "a1" }] }))).toEqual(["l1", "l2"]);
    expect(ids(runQuery(LESSONS, { where: [{ field: "stats.tries", op: "==", value: 1 }] }))).toEqual(["l3"]);
    expect(ids(runQuery(LESSONS, { where: [{ field: "done", op: "==", value: true }] }))).toEqual(["l1", "l3"]);
  });

  it("< <= > >= compare numbers by value and strings by order", () => {
    expect(ids(runQuery(LESSONS, { where: [{ field: "stats.score", op: "<", value: 75 }] }))).toEqual(["l2"]);
    expect(ids(runQuery(LESSONS, { where: [{ field: "stats.score", op: "<=", value: 75 }] }))).toEqual(["l2", "l3"]);
    expect(ids(runQuery(LESSONS, { where: [{ field: "stats.score", op: ">", value: 75 }] }))).toEqual(["l1"]);
    expect(ids(runQuery(LESSONS, { where: [{ field: "stats.score", op: ">=", value: 75 }] }))).toEqual(["l1", "l3"]);
    expect(ids(runQuery(LESSONS, { where: [{ field: "title", op: ">=", value: "N" }] }))).toEqual(["l2", "l4"]);
  });

  it("!= keeps what has the field with another value", () => {
    expect(ids(runQuery(LESSONS, { where: [{ field: "level", op: "!=", value: "a1" }] }))).toEqual(["l3", "l4"]);
  });

  it("🔴 a missing field never matches, whatever the operator (not even !=)", () => {
    // l4 has no `stats`.
    for (const op of ["==", "!=", "<", "<=", ">", ">="] as const) {
      expect(ids(runQuery(LESSONS, { where: [{ field: "stats.score", op, value: 1000 }] }))).not.toContain("l4");
    }
    expect(runQuery(LESSONS, { where: [{ field: "nothing.here", op: "!=", value: 1 }] })).toEqual([]);
  });

  it("a value of another type never satisfies an ordering, and a null field is a value like any other", () => {
    const mixed = [doc("a", { x: 5 }), doc("b", { x: "5" }), doc("c", { x: null }), doc("d", { x: true })];
    expect(ids(runQuery(mixed, { where: [{ field: "x", op: ">", value: 1 }] }))).toEqual(["a"]);
    expect(ids(runQuery(mixed, { where: [{ field: "x", op: "<", value: "9" }] }))).toEqual(["b"]);
    expect(ids(runQuery(mixed, { where: [{ field: "x", op: "==", value: null }] }))).toEqual(["c"]);
    expect(ids(runQuery(mixed, { where: [{ field: "x", op: "!=", value: 5 }] }))).toEqual(["b", "c", "d"]);
  });

  it("== compares objects and arrays by content", () => {
    const rich = [doc("a", { tags: ["x", "y"], at: { h: 9 } }), doc("b", { tags: ["x"], at: { h: 9 } })];
    expect(ids(runQuery(rich, { where: [{ field: "tags", op: "==", value: ["x", "y"] }] }))).toEqual(["a"]);
    expect(ids(runQuery(rich, { where: [{ field: "at", op: "==", value: { h: 9 } }] }))).toEqual(["a", "b"]);
  });

  it("several conditions are all required", () => {
    const q = { where: [{ field: "level", op: "==", value: "a2" }, { field: "done", op: "==", value: true }] } as const;
    expect(ids(runQuery(LESSONS, q))).toEqual(["l3"]);
  });

  it("walks only a document's own data: never the prototype, never an array's length", () => {
    const one = [doc("a", { list: [1, 2, 3], plain: 1 })];
    expect(runQuery(one, { where: [{ field: "constructor", op: "!=", value: 1 }] })).toEqual([]);
    expect(runQuery(one, { where: [{ field: "__proto__", op: "!=", value: 1 }] })).toEqual([]);
    expect(runQuery(one, { where: [{ field: "list.length", op: "==", value: 3 }] })).toEqual([]);
    expect(ids(runQuery(one, { where: [{ field: "list.1", op: "==", value: 2 }] }))).toEqual(["a"]);
  });

  it("a document whose data is not an object has no fields", () => {
    expect(runQuery([doc("a", "text"), doc("b", null), doc("c", 7)], { where: [{ field: "x", op: "==", value: 1 }] })).toEqual([]);
  });
});

describe("orderBy", () => {
  it("sorts ascending by default and descending on request, on a dotted path", () => {
    expect(ids(runQuery(LESSONS, { orderBy: { field: "stats.score" } }))).toEqual(["l2", "l3", "l1", "l4"]);
    expect(ids(runQuery(LESSONS, { orderBy: { field: "stats.score", direction: "asc" } }))).toEqual(["l2", "l3", "l1", "l4"]);
    expect(ids(runQuery(LESSONS, { orderBy: { field: "stats.score", direction: "desc" } }))).toEqual(["l1", "l3", "l2", "l4"]);
  });

  it("sorts strings", () => {
    expect(ids(runQuery(LESSONS, { orderBy: { field: "title" } }))).toEqual(["l3", "l1", "l2", "l4"]);
    expect(ids(runQuery(LESSONS, { orderBy: { field: "title", direction: "desc" } }))).toEqual(["l4", "l2", "l1", "l3"]);
  });

  it("🔴 keeps the documents that lack the field after the rest, either way: nothing disappears from the list", () => {
    // l4 has no `stats`.
    expect(ids(runQuery(LESSONS, { orderBy: { field: "stats.score", direction: "asc" } })).at(-1)).toBe("l4");
    expect(ids(runQuery(LESSONS, { orderBy: { field: "stats.score", direction: "desc" } })).at(-1)).toBe("l4");
  });

  it("equal values keep the order the documents came in", () => {
    expect(ids(runQuery(LESSONS, { orderBy: { field: "level", direction: "desc" } }))).toEqual(["l3", "l4", "l1", "l2"]);
  });

  it("sorts after filtering, and never changes the documents it was given", () => {
    const before = [...LESSONS];
    const got = runQuery(LESSONS, { where: [{ field: "done", op: "==", value: true }], orderBy: { field: "stats.score", direction: "asc" } });
    expect(ids(got)).toEqual(["l3", "l1"]);
    expect(LESSONS).toEqual(before);
    expect(got[0]).toBe(LESSONS[2]);
  });
});

describe("limit", () => {
  const MANY = Array.from({ length: 150 }, (_, i) => doc(`d${String(i).padStart(3, "0")}`, { n: i }));

  it("cuts to the limit asked", () => {
    expect(runQuery(MANY, { limit: 5 })).toHaveLength(5);
    expect(ids(runQuery(MANY, { orderBy: { field: "n", direction: "desc" }, limit: 2 }))).toEqual(["d149", "d148"]);
  });

  it("🔴 is capped at 100, and 100 is also what no limit means", () => {
    expect(AGENT_TOOL_QUERY_LIMIT_MAX).toBe(100);
    expect(runQuery(MANY, { limit: 500 })).toHaveLength(100);
    expect(runQuery(MANY, {})).toHaveLength(100);
  });

  it("a limit that is no number means no limit asked; 0 returns nothing; a fraction rounds down", () => {
    expect(runQuery(MANY, { limit: Number.NaN })).toHaveLength(100);
    expect(runQuery(MANY, { limit: 0 })).toEqual([]);
    expect(runQuery(MANY, { limit: -3 })).toEqual([]);
    expect(runQuery(MANY, { limit: 2.9 })).toHaveLength(2);
  });
});
