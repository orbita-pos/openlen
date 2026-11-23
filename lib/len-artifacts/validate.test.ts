// @vitest-environment node
import { describe, expect, it } from "vitest";

import { LEN_ARTIFACT_QUERY_LIMIT_MAX } from "./limits";
import { parseQuery, parseRead, parseWrite } from "./validate";

// THE CHECKS OF AN AGENT TOOL'S DATA CALL (spec local 2026-11-22-herramienta-dentro-del-agente, §3): one set of rules and
// sentences for the agent's `artifact_data` and for the tool's page (the route the bridge reaches). The wire names differ — the
// agent says `doc_id`, the page `docId` — so the sentence names whichever the caller speaks.

describe("parseQuery", () => {
  it("nothing is an empty query", () => {
    expect(parseQuery(undefined)).toEqual({ query: {} });
  });

  it("keeps a good query as it is", () => {
    const raw = { where: [{ field: "a.b", op: ">=", value: 3 }], orderBy: { field: "a", direction: "desc" }, limit: 5 };
    expect(parseQuery(raw)).toEqual({ query: raw });
  });

  it("says which part is wrong", () => {
    expect(parseQuery("x")).toEqual({ problem: expect.stringContaining("query must be an object") });
    expect(parseQuery({ nope: 1 })).toEqual({ problem: 'query has no "nope": it takes where, orderBy and limit.' });
    expect(parseQuery({ where: {} })).toEqual({ problem: expect.stringContaining("query.where must be a list") });
    expect(parseQuery({ where: [{ field: "a", op: "~", value: 1 }] })).toEqual({ problem: expect.stringContaining("query.where[0].op must be one of") });
    expect(parseQuery({ where: [{ field: "a", op: "==" }] })).toEqual({ problem: expect.stringContaining("query.where[0].value is required") });
    expect(parseQuery({ orderBy: { field: "a", direction: "up" } })).toEqual({ problem: expect.stringContaining('"asc" or "desc"') });
    expect(parseQuery({ limit: LEN_ARTIFACT_QUERY_LIMIT_MAX + 1 })).toEqual({ problem: expect.stringContaining(`from 1 to ${LEN_ARTIFACT_QUERY_LIMIT_MAX}`) });
  });

  it("refuses what a condition or orderBy doesn't take: a typo would silently change the answer", () => {
    expect(parseQuery({ where: [{ field: "a", op: "==", value: 1, opp: "!=" }] })).toEqual({
      problem: 'query.where[0] has no "opp": a condition takes field, op and value.',
    });
    expect(parseQuery({ orderBy: { field: "age", dir: "desc" } })).toEqual({ problem: 'query.orderBy has no "dir": it takes field and direction.' });
    expect(parseQuery({ where: [{ field: "a", op: "==", value: 1 }], orderBy: { field: "a", direction: "asc" } })).toEqual({
      query: { where: [{ field: "a", op: "==", value: 1 }], orderBy: { field: "a", direction: "asc" } },
    });
  });
});

describe("parseRead", () => {
  it("get needs a collection and an id, query a collection, list neither", () => {
    expect(parseRead("get", { collection: "c", docId: "d" })).toEqual({ collection: "c", docId: "d", query: {} });
    expect(parseRead("list", {})).toEqual({ collection: null, docId: null, query: {} });
    expect(parseRead("list", { collection: "c" })).toEqual({ collection: "c", docId: null, query: {} });
    expect(parseRead("query", { collection: "c", query: { limit: 2 } })).toEqual({ collection: "c", docId: null, query: { limit: 2 } });
    expect(parseRead("get", { docId: "d" })).toEqual({ problem: "collection is required for get." });
    expect(parseRead("get", { collection: "c" })).toEqual({ problem: "doc_id is required for get." });
    expect(parseRead("query", {})).toEqual({ problem: "collection is required for query." });
    expect(parseRead("query", { collection: "c", query: 4 })).toEqual({ problem: expect.stringContaining("query must be an object") });
  });

  it("a blank name is no name, and a name is never trimmed", () => {
    expect(parseRead("get", { collection: "  ", docId: "d" })).toEqual({ problem: "collection is required for get." });
    expect(parseRead("get", { collection: " c ", docId: "d" })).toEqual({ collection: " c ", docId: "d", query: {} });
  });

  it("names the id the way the caller speaks", () => {
    expect(parseRead("get", { collection: "c" }, "docId")).toEqual({ problem: "docId is required for get." });
  });
});

describe("parseWrite", () => {
  it("set and update take a JSON object, delete takes none", () => {
    expect(parseWrite("set", { collection: "c", docId: "d", data: { a: 1 } })).toEqual({ write: { op: "set", collection: "c", docId: "d", data: { a: 1 } } });
    expect(parseWrite("update", { collection: "c", docId: "d", data: {} })).toEqual({ write: { op: "update", collection: "c", docId: "d", data: {} } });
    expect(parseWrite("delete", { collection: "c", docId: "d", data: 7 })).toEqual({ write: { op: "delete", collection: "c", docId: "d" } });
  });

  it("says what is missing", () => {
    expect(parseWrite("set", { docId: "d", data: {} })).toEqual({ problem: "collection is required for set." });
    expect(parseWrite("update", { collection: "c", data: {} })).toEqual({ problem: "doc_id is required for update." });
    expect(parseWrite("delete", { collection: "c" })).toEqual({ problem: "doc_id is required for delete." });
    expect(parseWrite("set", { collection: "c", docId: "d" })).toEqual({ problem: "data is required for set: the document, a JSON object." });
    expect(parseWrite("set", { collection: "c", docId: "d", data: [1] })).toEqual({ problem: "data is required for set: the document, a JSON object." });
    expect(parseWrite("update", { collection: "c", docId: "d", data: "x" })).toEqual({ problem: "data is required for update: the document, a JSON object." });
  });

  it("names the id the way the caller speaks", () => {
    expect(parseWrite("delete", { collection: "c" }, "docId")).toEqual({ problem: "docId is required for delete." });
  });
});
