// @vitest-environment node
// What a project takes on its «disk» (LOCAL database only, with the schema pushed).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { makePointer } from "./blob-pointer";
import { projectUsageBytes } from "./quota";

const OWNER = "test-quota-owner";
const PROJECT = "test-quota-project";

async function clean() {
  for (const table of ["projectFiles", "projectGitObjects", "projects"]) {
    await db.execute(sql.raw(`delete from "${table}" where "${table === "projects" ? "id" : "projectId"}" = '${PROJECT}'`));
  }
}

beforeAll(async () => {
  await exigirBaseLocal();
  await db.execute(sql`insert into "users" ("id", "email", "name") values (${OWNER}, ${`${OWNER}@example.invalid`}, ${"Owner"}) on conflict do nothing`);
  await clean();
  const data = { html: "abc", pages: { menu: { html: "de" } } };
  await db.execute(sql`insert into "projects" ("id", "userId", "title", "brief", "data") values (${PROJECT}, ${OWNER}, ${"q"}, ${""}, ${JSON.stringify(data)}::jsonb)`);
  const pointer = makePointer({ sha256: "a".repeat(64), size: 1000, gitOid: "b".repeat(40) });
  await db.execute(sql`insert into "projectFiles" ("projectId", "path", "content") values (${PROJECT}, ${"/a.txt"}, ${"hola"}), (${PROJECT}, ${"/img/a.png"}, ${pointer})`);
  await db.execute(sql`insert into "projectGitObjects" ("projectId", "oid", "type", "content") values (${PROJECT}, ${"c".repeat(40)}, ${"blob"}, ${Buffer.from("12345")})`);
});

afterAll(async () => {
  await clean();
  await db.execute(sql`delete from "users" where "id" = ${OWNER}`);
});

describe("projectUsageBytes", () => {
  it("counts pages, the folder (a binary by its pointer's size) and git's history, like a disk", async () => {
    expect(await projectUsageBytes(PROJECT)).toBe(3 + 2 + 4 + 1000 + 5);
  });

  it("a project with nothing is 0", async () => {
    expect(await projectUsageBytes("no-such-project")).toBe(0);
  });
});
