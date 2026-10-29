// @vitest-environment node
// Branches in Postgres (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8): which branch is checked out and
// every branch survive a fresh store; a write without branching moves only the current one (LOCAL database only, with
// `npm run git:migrate`).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { postgresStore } from "./postgres-store";

const OWNER = "test-gitbranch-owner";
const PROJECT = "test-gitbranch-project";
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

async function clean() {
  await db.execute(sql`delete from "projectGitRepos" where "projectId" = ${PROJECT}`);
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

describe("branches in Postgres", () => {
  it("a repository is born on main; a switch and a later commit come back from a fresh store", async () => {
    const born = await postgresStore(PROJECT).createRepo(A, {});
    expect(born).toMatchObject({ head: A, branch: "main", refs: { main: A } });
    const switched = await postgresStore(PROJECT).updateRepo(born.version, A, {}, { branch: "nueva", refs: { main: A, nueva: A } });
    expect(switched).toMatchObject({ head: A, branch: "nueva", refs: { main: A, nueva: A } });
    // A commit on the current branch, without branching: only `nueva` moves.
    const committed = await postgresStore(PROJECT).updateRepo(switched!.version, B, { "x.txt": C });
    expect(committed).toMatchObject({ head: B, branch: "nueva", refs: { main: A, nueva: B } });
    const back = await postgresStore(PROJECT).readRepo();
    expect(back).toMatchObject({ head: B, branch: "nueva", refs: { main: A, nueva: B }, index: { "x.txt": C }, merge: null });

    // A merge in progress survives a fresh store; a write without `merge` keeps it; null ends it.
    const merging = { theirs: A, message: "Merge branch 'main' into nueva\n", conflicts: { "x.txt": "UU" as const } };
    const started = await postgresStore(PROJECT).updateRepo(back!.version, B, back!.index, undefined, merging);
    const kept = await postgresStore(PROJECT).updateRepo(started!.version, B, back!.index);
    expect(kept?.merge).toEqual(merging);
    expect((await postgresStore(PROJECT).readRepo())?.merge).toEqual(merging);
    await postgresStore(PROJECT).updateRepo(kept!.version, B, back!.index, undefined, null);
    expect((await postgresStore(PROJECT).readRepo())?.merge).toBeNull();
  });
});
