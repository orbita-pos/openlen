// @vitest-environment node
//
// A person's credentials, encrypted at rest (lib/integrations/crypto.ts), against real Postgres (PGlite).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

process.env.NEXTAUTH_SECRET ??= "test-secret-for-credentials";

const base = vi.hoisted(() => ({ db: null as unknown, pg: null as unknown }));
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
const { credentialNames, deleteCredential, resolveCredentials, setCredential } = await import("./credentials");

let pg: PGlite;
beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`CREATE TABLE "users" ("id" text PRIMARY KEY);`);
  await pg.query(`INSERT INTO "users" ("id") VALUES ('p1'), ('p2');`);
  for (const statement of CREATE_MCP_CONNECTORS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
});

describe("credentials", () => {
  it("credential round-trips encrypted", async () => {
    await setCredential("p1", "NOTION_TOKEN", "ntn_secret_value");
    const raw = await pg.query<{ value: string }>(`SELECT "value" FROM "personCredentials"`);
    expect(raw.rows[0]!.value).not.toContain("ntn_secret_value");
    expect(raw.rows[0]!.value.startsWith("v1:")).toBe(true);
    expect(await resolveCredentials("p1", ["NOTION_TOKEN", "OTHER"])).toEqual(new Map([["NOTION_TOKEN", "ntn_secret_value"]]));
  });

  it("credentialNames never returns values", async () => {
    await setCredential("p1", "A", "va");
    await setCredential("p1", "B", "vb");
    const names = await credentialNames("p1");
    expect(names.map((n) => n.name)).toEqual(["A", "B"]);
    expect(JSON.stringify(names)).not.toContain("va");
  });

  it("setting again replaces, delete removes, and people never mix", async () => {
    await setCredential("p1", "A", "one");
    await setCredential("p1", "A", "two");
    expect(await resolveCredentials("p1", ["A"])).toEqual(new Map([["A", "two"]]));
    expect(await resolveCredentials("p2", ["A"])).toEqual(new Map());
    await deleteCredential("p1", "A");
    expect(await credentialNames("p1")).toEqual([]);
  });

  it("a row that doesn't decrypt counts as missing", async () => {
    await pg.query(`INSERT INTO "personCredentials" ("personId","name","value") VALUES ('p1','BROKEN','v1:AAAA')`);
    expect(await resolveCredentials("p1", ["BROKEN"])).toEqual(new Map());
  });

  it("refuses a malformed name", async () => {
    await expect(setCredential("p1", "lower", "x")).rejects.toThrow(/name/);
  });
});
