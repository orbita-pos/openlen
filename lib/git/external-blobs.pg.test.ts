// @vitest-environment node
// A binary's blob in Postgres (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8): only its pointer; the bytes
// stay in storage, where the folder already keeps them (LOCAL database only, with `npm run git:migrate`).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { makePointer } from "@/lib/files/blob-pointer";

import { blobForContent } from "./content";
import { postgresStore } from "./postgres-store";

const OWNER = "test-gitblob-owner";
const PROJECT = "test-gitblob-project";
const POINTER = makePointer({ sha256: "c".repeat(64), size: 600_000, gitOid: "d".repeat(40) });

async function clean() {
  await db.execute(sql`delete from "projectGitObjects" where "projectId" = ${PROJECT}`);
  await db.execute(sql`delete from "projects" where "id" = ${PROJECT}`);
}

beforeAll(async () => {
  await exigirBaseLocal();
  await db.execute(sql`insert into "users" ("id", "email", "name") values (${OWNER}, ${`${OWNER}@example.invalid`}, ${"Owner"}) on conflict do nothing`);
  await clean();
  await db.execute(sql`insert into "projects" ("id", "userId", "title", "brief", "data") values (${PROJECT}, ${OWNER}, ${"g"}, ${""}, ${JSON.stringify({ html: "x" })}::jsonb)`);
});
afterAll(async () => {
  await clean();
  await db.execute(sql`delete from "users" where "id" = ${OWNER}`);
});

describe("external blobs in Postgres", () => {
  it("the row keeps the pointer and no bytes; reading it back gives the external blob", async () => {
    const blob = blobForContent(POINTER);
    await postgresStore(PROJECT).writeObjects([blob]);
    const r = (await db.execute(sql`select octet_length("content") as n, "blobPointer" as p from "projectGitObjects" where "projectId" = ${PROJECT} and "oid" = ${blob.oid}`)) as unknown as
      | { rows: { n: number; p: string }[] }
      | { n: number; p: string }[];
    const row = Array.isArray(r) ? r[0] : r.rows[0];
    expect(row).toEqual({ n: 0, p: POINTER });
    // A fresh store (no cache): the external ref comes back from the row.
    const back = (await postgresStore(`${PROJECT}`).readObjects([blob.oid])).get(blob.oid);
    expect(back?.external).toEqual({ sha256: "c".repeat(64), size: 600_000, gitOid: "d".repeat(40) });
  });
});
