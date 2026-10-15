// @vitest-environment node
// The repository in Postgres (LOCAL database only), with `npm run git:migrate` applied.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { INDEX_LOCKED } from "./errors";
import { blobOf, makeObject, encodeTree } from "./objects";
import { postgresStore } from "./postgres-store";
import { runGit } from "./run";
import { AUTHOR, START } from "./test-support/real-git";

const OWNER = "test-git-owner";
const PROJECT = "test-git-project";

beforeAll(async () => {
  await exigirBaseLocal();
  // Only the columns this test needs: the local dev database may lack unrelated newer ones.
  await db.execute(sql`insert into "users" ("id", "email", "name") values (${OWNER}, ${`${OWNER}@example.invalid`}, ${"Owner"}) on conflict do nothing`);
});
beforeEach(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROJECT));
  await db.execute(sql`insert into "projects" ("id", "userId", "title", "brief", "data") values (${PROJECT}, ${OWNER}, ${"git"}, ${""}, ${JSON.stringify({ html: "<h1>x</h1>" })}::jsonb)`);
});
afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROJECT));
  await db.delete(schema.users).where(eq(schema.users.id, OWNER));
});

const run = (args: string[], files: Record<string, string>, store = postgresStore(PROJECT)) =>
  runGit({ store, files, cwd: "/", identity: AUTHOR, owner: AUTHOR, now: () => new Date(START * 1000) }, args);

describe("the repository in Postgres", () => {
  it("objects round-trip byte for byte (a tree's binary oids included)", async () => {
    const store = postgresStore(PROJECT);
    const blob = blobOf("ñandú\n");
    const tree = makeObject("tree", encodeTree([{ name: "a.txt", mode: "100644", oid: blob.oid }]));
    await store.writeObjects([blob, tree, blob]);
    const got = await postgresStore(PROJECT).readObjects([blob.oid, tree.oid, "f".repeat(40)]);
    expect(Buffer.from(got.get(tree.oid)!.content).equals(Buffer.from(tree.content))).toBe(true);
    expect(got.get(blob.oid)!.type).toBe("blob");
    expect(got.has("f".repeat(40))).toBe(false);
    expect(await store.findByPrefix(blob.oid.slice(0, 6))).toEqual([blob.oid]);
  });

  it("two creators at once leave one repository", async () => {
    const a = postgresStore(PROJECT);
    const b = postgresStore(PROJECT);
    const [ra, rb] = await Promise.all([a.createRepo("a".repeat(40), {}), b.createRepo("b".repeat(40), {})]);
    expect(ra).toEqual(rb);
  });

  it("compare-and-swap: the second writer with the old version gets null", async () => {
    const store = postgresStore(PROJECT);
    const repo = await store.createRepo("a".repeat(40), { "x.txt": "c".repeat(40) });
    expect(await store.updateRepo(repo.version, "d".repeat(40), {})).toMatchObject({ head: "d".repeat(40), version: repo.version + 1 });
    expect(await store.updateRepo(repo.version, "e".repeat(40), {})).toBeNull();
  });

  it("git end to end: commit, log, and a late commit gets index.lock", async () => {
    const files = { "/index.html": "<h1>Hola</h1>\n" };
    expect((await run(["status", "-s"], files)).stdout).toBe("");
    const stale = await postgresStore(PROJECT).readRepo();
    expect((await run(["commit", "-am", "Louder"], { "/index.html": "<h1>HOLA</h1>\n" })).exitCode).toBe(0);
    const racing = { ...postgresStore(PROJECT), readRepo: async () => stale };
    expect(await run(["commit", "-am", "Late"], { "/index.html": "<h1>hola</h1>\n" }, racing)).toEqual({ stdout: "", stderr: INDEX_LOCKED, exitCode: 128 });
    expect((await run(["log", "--format=%s"], { "/index.html": "<h1>HOLA</h1>\n" })).stdout).toBe("Louder\nInitial commit\n");
  });

  it("deleting the project deletes its repository", async () => {
    await run(["status"], { "/index.html": "x\n" });
    await db.delete(schema.projects).where(eq(schema.projects.id, PROJECT));
    expect(await db.select().from(schema.projectGitRepos).where(eq(schema.projectGitRepos.projectId, PROJECT))).toEqual([]);
    expect(await db.select().from(schema.projectGitObjects).where(eq(schema.projectGitObjects.projectId, PROJECT))).toEqual([]);
  });
});
