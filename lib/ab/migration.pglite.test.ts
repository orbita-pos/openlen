// @vitest-environment node
// THE A/B MIGRATION DOESN'T BLOCK THE BEACON (review item 4).
//
// `pageEvents` takes an insert on every page view of every published site, and `formSubmissions` the leads. A plain
// `CREATE INDEX` holds a lock that stops those writes until the index is built; on the box the migration runs in the
// deploy, before the swap. The two indexes on those tables are built CONCURRENTLY (outside a transaction, one statement
// each), under a `lock_timeout` so a DDL that queues behind a long transaction gives up instead of making every insert
// queue behind IT. PGlite is Postgres, and runs CREATE INDEX CONCURRENTLY, so the real runner is exercised here.
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AB_LOCK_TIMEOUT,
  CREATE_AB_TESTING,
  CREATE_AB_TESTING_CONCURRENT,
  runAbTestingMigration,
  type MigrationClient,
} from "@/scripts/ab-testing-migrate-sql";

let pg: PGlite;
beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY, "userId" text NOT NULL, "title" text NOT NULL DEFAULT 'Sitio');`);
  await pg.query(`CREATE TABLE "assistants" ("id" text PRIMARY KEY);`);
  await pg.query(`CREATE TABLE "pageEvents" ("id" text PRIMARY KEY, "projectId" text NOT NULL, "type" text NOT NULL, "cid" text, "uaHash" text, "ts" timestamp NOT NULL DEFAULT now());`);
  await pg.query(`CREATE TABLE "formSubmissions" ("id" text PRIMARY KEY, "projectId" text NOT NULL, "meta" jsonb, "createdAt" timestamp NOT NULL DEFAULT now());`);
});

const indexState = async (name: string) =>
  (await pg.query<{ indisvalid: boolean }>(`SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1`, [name])).rows[0];

describe("the migration's SQL", () => {
  it("🔴 the indexes on the hot tables are CONCURRENTLY and are not in the plain list (which would run them with a lock)", () => {
    expect(CREATE_AB_TESTING.some((s) => /"pageEvents"\s*\(|"formSubmissions"\s*\(/.test(s) && /CREATE\s+INDEX/i.test(s))).toBe(false);
    expect(CREATE_AB_TESTING_CONCURRENT.map((i) => i.name).sort()).toEqual(["formSubmissions_projectId_ab_idx", "pageEvents_projectId_ab_ts_idx"]);
    for (const i of CREATE_AB_TESTING_CONCURRENT) {
      expect(i.sql).toMatch(/CREATE\s+INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS/i);
      expect(i.sql).toContain(`"${i.name}"`);
    }
    expect(AB_LOCK_TIMEOUT).toMatch(/^\d+s$/);
  });
});

describe("the runner", () => {
  it("🔴 builds everything, the two indexes valid, with a lock_timeout set first and no transaction around the indexes", async () => {
    const seen: string[] = [];
    const client: MigrationClient = {
      query: async (text, params) => {
        seen.push(text.trim().split(/\s+/).slice(0, 3).join(" "));
        return (await pg.query(text, params as unknown[])) as { rows: Array<Record<string, unknown>> };
      },
    };
    await runAbTestingMigration(client, { sleep: async () => undefined });
    expect(seen[0]).toBe(`SET lock_timeout =`);
    expect(seen.some((s) => /^BEGIN|^COMMIT/i.test(s))).toBe(false);
    expect((await indexState("pageEvents_projectId_ab_ts_idx"))?.indisvalid).toBe(true);
    expect((await indexState("formSubmissions_projectId_ab_idx"))?.indisvalid).toBe(true);
    expect((await pg.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'pageEvents' AND column_name = 'ab'`)).rows).toHaveLength(1);
  });

  it("is idempotent: running it again changes nothing and fails nothing", async () => {
    await runAbTestingMigration(pg as unknown as MigrationClient, { sleep: async () => undefined });
    await expect(runAbTestingMigration(pg as unknown as MigrationClient, { sleep: async () => undefined })).resolves.toBeUndefined();
    expect((await indexState("pageEvents_projectId_ab_ts_idx"))?.indisvalid).toBe(true);
  });

  it("🔴 an INVALID index left by an interrupted build is dropped and rebuilt (IF NOT EXISTS alone would skip it forever)", async () => {
    await runAbTestingMigration(pg as unknown as MigrationClient, { sleep: async () => undefined });
    await pg.query(`UPDATE pg_index SET indisvalid = false WHERE indexrelid = '"pageEvents_projectId_ab_ts_idx"'::regclass`);
    expect((await indexState("pageEvents_projectId_ab_ts_idx"))?.indisvalid).toBe(false);
    await runAbTestingMigration(pg as unknown as MigrationClient, { sleep: async () => undefined });
    expect((await indexState("pageEvents_projectId_ab_ts_idx"))?.indisvalid).toBe(true);
  });

  it("a statement that times out waiting for a lock (55P03) is retried, then succeeds", async () => {
    let failures = 0;
    const waits: number[] = [];
    const client: MigrationClient = {
      query: async (text, params) => {
        if (/ALTER TABLE "pageEvents"/.test(text) && failures < 2) {
          failures++;
          throw Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
        }
        return (await pg.query(text, params as unknown[])) as { rows: Array<Record<string, unknown>> };
      },
    };
    await runAbTestingMigration(client, { sleep: async (ms) => void waits.push(ms) });
    expect(failures).toBe(2);
    expect(waits).toHaveLength(2);
    expect((await indexState("pageEvents_projectId_ab_ts_idx"))?.indisvalid).toBe(true);
  });

  it("gives up with the lock error after the attempts, and any other error goes straight up", async () => {
    const stuck: MigrationClient = {
      query: async (text) => {
        if (/^\s*SET lock_timeout/.test(text)) return { rows: [] };
        throw Object.assign(new Error("lock timeout"), { code: "55P03" });
      },
    };
    await expect(runAbTestingMigration(stuck, { sleep: async () => undefined })).rejects.toThrow(/lock timeout/);
    const broken: MigrationClient = {
      query: async (text) => {
        if (/^\s*SET lock_timeout/.test(text)) return { rows: [] };
        throw new Error("permission denied");
      },
    };
    await expect(runAbTestingMigration(broken, { sleep: async () => undefined })).rejects.toThrow(/permission denied/);
  });
});

describe("the invalid-index probe looks at THIS schema's index (G1+G3 review, item 21)", () => {
  it("🔴 a same-named index in another schema doesn't hide an invalid one in public: it is still repaired", async () => {
    // Created FIRST, so a probe by bare name finds it before public's.
    await pg.query(`CREATE SCHEMA other`);
    await pg.query(`CREATE TABLE other."pageEvents" ("id" text, "projectId" text, "ab" text, "ts" timestamp)`);
    await pg.query(`CREATE INDEX "pageEvents_projectId_ab_ts_idx" ON other."pageEvents" ("projectId", "ab", "ts")`);
    await runAbTestingMigration(pg as unknown as MigrationClient, { sleep: async () => undefined });
    await pg.query(`UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public."pageEvents_projectId_ab_ts_idx"'::regclass`);
    await runAbTestingMigration(pg as unknown as MigrationClient, { sleep: async () => undefined });
    const valid = async (schema: string) =>
      (await pg.query<{ v: boolean }>(`SELECT i.indisvalid AS v FROM pg_index i WHERE i.indexrelid = to_regclass($1)`, [`${schema}."pageEvents_projectId_ab_ts_idx"`])).rows[0]?.v;
    expect(await valid("public")).toBe(true);
    expect(await valid("other")).toBe(true);
  });

  it("the probe is the schema-qualified regclass, and the drop is qualified too", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "scripts/ab-testing-migrate-sql.ts"), "utf8");
    expect(src).toContain("to_regclass($1)");
    expect(src).toContain('`public."${index.name}"`');
    expect(src).toContain('DROP INDEX CONCURRENTLY IF EXISTS public."${index.name}"');
  });
});
