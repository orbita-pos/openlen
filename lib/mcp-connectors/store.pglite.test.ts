// @vitest-environment node
//
// A person's connectors config and server states, against real Postgres (PGlite), with the tables as
// `scripts/mcp-connectors-migrate.ts` creates them.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});

const { CREATE_MCP_CONNECTORS } = await import("@/scripts/mcp-connectors-migrate-sql");
const { approve, deleteServerState, markStale, readMcpConfig, readServerStates, saveServerState, writeMcpConfig } = await import("./store");
const { EMPTY_MCP_CONFIG } = await import("./config");

const TEXT = '{\n  "servers": { "a": {}, "b": {} }\n}\n';

beforeEach(async () => {
  const pg = new PGlite();
  await pg.query(`CREATE TABLE "users" ("id" text PRIMARY KEY);`);
  await pg.query(`INSERT INTO "users" ("id") VALUES ('p1'), ('p2');`);
  for (const statement of CREATE_MCP_CONNECTORS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
});

const state = (serverName: string, over: Partial<Parameters<typeof saveServerState>[1]> = {}) => ({
  serverName,
  fingerprint: "f",
  tools: [],
  instructions: "",
  hasResources: false,
  listedAt: null,
  status: "connected" as const,
  error: null,
  stale: false,
  ...over,
});

describe("connectors config", () => {
  it("no row reads as the empty file at version 0", async () => {
    expect(await readMcpConfig("p1")).toEqual({ text: EMPTY_MCP_CONFIG, approved: {}, version: 0 });
  });

  it("config CAS refuses a stale version", async () => {
    expect(await writeMcpConfig("p1", TEXT, 0, { a: "fa" }, ["a", "b"])).toEqual({ ok: true, version: 1 });
    expect(await writeMcpConfig("p1", TEXT, 0, {}, ["a", "b"])).toEqual({ ok: false, reason: "conflict" });
    expect(await readMcpConfig("p1")).toEqual({ text: TEXT, approved: { a: "fa" }, version: 1 });
  });

  it("approvals of removed servers are dropped", async () => {
    await writeMcpConfig("p1", TEXT, 0, { a: "fa", b: "fb" }, ["a", "b"]);
    await writeMcpConfig("p1", '{ "servers": { "b": {} } }', 1, {}, ["b"]);
    expect((await readMcpConfig("p1")).approved).toEqual({ b: "fb" });
  });

  it("approve is compare-and-swap on the version", async () => {
    await writeMcpConfig("p1", TEXT, 0, {}, ["a", "b"]);
    expect(await approve("p1", "a", "fa", 0)).toBe(false);
    expect(await approve("p1", "a", "fa", 1)).toBe(true);
    const after = await readMcpConfig("p1");
    expect(after.approved).toEqual({ a: "fa" });
    expect(after.version).toBe(2);
  });

  it("people never share a config", async () => {
    await writeMcpConfig("p1", TEXT, 0, {}, ["a", "b"]);
    expect((await readMcpConfig("p2")).version).toBe(0);
  });
});

describe("server states", () => {
  it("state upsert keeps one row per server", async () => {
    await saveServerState("p1", state("a", { error: "first" }));
    await saveServerState("p1", state("a", { error: "second", status: "failed" }));
    const rows = await readServerStates("p1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ serverName: "a", error: "second", status: "failed" });
  });

  it("markStale flags and delete removes", async () => {
    await saveServerState("p1", state("a"));
    await markStale("p1", "a");
    expect((await readServerStates("p1"))[0]?.stale).toBe(true);
    await deleteServerState("p1", "a");
    expect(await readServerStates("p1")).toEqual([]);
  });
});
