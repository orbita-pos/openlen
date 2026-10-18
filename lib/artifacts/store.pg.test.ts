// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ARTIFACT_MIGRATION_SQL } from "./migration";
import { createArtifactStore } from "./store";
import type { ArtifactContext, ArtifactDatabase, JobClaim } from "./types";

const pg = new PGlite();
const database: ArtifactDatabase = {
  query: async (text, values = []) => (await pg.query(text, [...values])).rows as Record<string, unknown>[],
  transaction: (fn) => pg.transaction(async (tx) => fn({ query: async (text, values = []) => (await tx.query(text, [...values])).rows as Record<string, unknown>[] })),
};
const store = createArtifactStore(database);
const ctx: ArtifactContext = { actorId: "owner", ownerId: "owner", projectId: "project", requestId: "", role: "dueno" };
const output = { key: "project/a/1/result.pdf", hash: "a".repeat(64), mime: "application/pdf", bytes: 123, format: "pdf" };
const evidence = { valid: true as const, checks: ["pdf opens"], checkedAt: "2026-10-17T12:00:00.000Z" };

async function makeArtifact() {
  const request = await store.ensureArtifactRequest(ctx, "message-1");
  const context = { ...ctx, requestId: request.id };
  const artifact = await store.createArtifact(context, { kind: "slides", title: "Demo", brief: "App", visibility: "project" });
  return { context, artifact };
}

async function storingJob(id: string, artifactId: string, revision: number): Promise<JobClaim> {
  const [row] = (await pg.query(`insert into "artifactJobs" ("id","artifactId","revision","operation","optionsHash","status","workerId","fencingToken","leaseUntil") values ($1,$2,$3,'export',$1,'storing','worker',$1,now()+interval '1 hour') returning *`, [id, artifactId, revision])).rows;
  return { job: row, workerId: "worker", fencingToken: id, leaseUntil: new Date(Date.now() + 3600_000) } as unknown as JobClaim;
}

beforeAll(async () => {
  await pg.exec(`create table "users" ("id" text primary key); create table "projects" ("id" text primary key,"userId" text not null references "users"("id")); create table "projectMembers" ("projectId" text,"userId" text,"rol" text); insert into "users" values ('owner'),('editor'),('reader'); insert into "projects" values ('project','owner'),('other','owner'); insert into "projectMembers" values ('project','editor','editor'),('project','reader','lector');`);
  await pg.exec(ARTIFACT_MIGRATION_SQL);
  await pg.exec(ARTIFACT_MIGRATION_SQL);
}, 30_000);
beforeEach(async () => { await pg.exec(`truncate "artifactRequests" cascade`); });
afterAll(async () => { await pg.close(); });

describe("durable artifact store", () => {
  it("sameMessageHasOneRequest while distinct messages remain distinct", async () => {
    const first = await store.ensureArtifactRequest(ctx, "message-1");
    const duplicate = await store.ensureArtifactRequest(ctx, "message-1");
    const second = await store.ensureArtifactRequest(ctx, "message-2");
    expect(duplicate.id).toBe(first.id);
    expect(second.id).not.toBe(first.id);
  });

  it("rejects a request from another project", async () => {
    const request = await store.ensureArtifactRequest({ ...ctx, projectId: "other" }, "message");
    await expect(store.createArtifact({ ...ctx, requestId: request.id }, { kind: "image", title: "a", brief: "a", visibility: "project" })).rejects.toMatchObject({ code: "request_not_found" });
  });

  it("sealedRevisionIsImmutable and staleWriteLeavesSourcesUntouched", async () => {
    const { context, artifact } = await makeArtifact();
    const revision = await store.writeArtifactFiles(context, artifact.id, 0, { "deck.json": '{"title":"Original"}' });
    await store.sealArtifactRevision(context, artifact.id, revision.revision);
    await expect(store.writeArtifactFiles(context, artifact.id, 0, { "deck.json": "stale" })).rejects.toMatchObject({ code: "revision_conflict" });
    const next = await store.writeArtifactFiles(context, artifact.id, 1, { "deck.json": '{"title":"New"}' });
    expect(next.revision).toBe(2);
    expect((await store.getRevision(context, artifact.id, 1)).files).toEqual({ "deck.json": '{"title":"Original"}' });
  });

  it("one of two concurrent writers wins and the loser cannot silently overwrite", async () => {
    const { context, artifact } = await makeArtifact();
    const outcomes = await Promise.allSettled([
      store.writeArtifactFiles(context, artifact.id, 0, { "deck.json": "one" }),
      store.writeArtifactFiles(context, artifact.id, 0, { "deck.json": "two" }),
    ]);
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((x) => x.status === "rejected")).toMatchObject({ reason: { code: "revision_conflict" } });
    expect((await store.getArtifact(context, artifact.id)).currentRevision).toBe(1);
  });

  it("olderJobCannotReplaceNewerReadyRevision and completion is idempotent", async () => {
    const { context, artifact } = await makeArtifact();
    await store.writeArtifactFiles(context, artifact.id, 0, { "deck.json": "one" });
    await store.sealArtifactRevision(context, artifact.id, 1);
    const older = await storingJob("job-old", artifact.id, 1);
    await store.writeArtifactFiles(context, artifact.id, 1, { "deck.json": "two" });
    await store.sealArtifactRevision(context, artifact.id, 2);
    const newer = await storingJob("job-new", artifact.id, 2);
    await store.recordArtifactResult(newer, { outputs: [output], evidence });
    await store.recordArtifactResult(older, { outputs: [output], evidence });
    await store.recordArtifactResult(newer, { outputs: [output], evidence });
    expect((await store.getArtifact(context, artifact.id)).lastReadyRevision).toBe(2);
    expect((await pg.query(`select * from "artifactEvents" where "type"='ready'`)).rows).toHaveLength(2);
  });

  it("rejects an expired or replaced worker before committing any result", async () => {
    const { context, artifact } = await makeArtifact();
    await store.writeArtifactFiles(context, artifact.id, 0, { "deck.json": "one" });
    await store.sealArtifactRevision(context, artifact.id, 1);
    const claim = await storingJob("old-lease", artifact.id, 1);
    await pg.query(`update "artifactJobs" set "fencingToken"='new-token' where "id"='old-lease'`);
    await expect(store.recordArtifactResult(claim, { outputs: [output], evidence })).rejects.toMatchObject({ code: "lease_lost" });
    expect((await store.getArtifact(context, artifact.id)).lastReadyRevision).toBeNull();
    expect((await pg.query(`select * from "artifactEvents" where "type"='ready'`)).rows).toHaveLength(0);
  });

  it("failedNewRevisionKeepsLastReady", async () => {
    const { context, artifact } = await makeArtifact();
    await store.writeArtifactFiles(context, artifact.id, 0, { "deck.json": "one" });
    await store.sealArtifactRevision(context, artifact.id, 1);
    await store.recordArtifactResult(await storingJob("first", artifact.id, 1), { outputs: [output], evidence });
    await store.writeArtifactFiles(context, artifact.id, 1, { "deck.json": "two" });
    await pg.query(`update "artifacts" set "status"='failed' where "id"=$1`, [artifact.id]);
    expect(await store.getArtifact(context, artifact.id)).toMatchObject({ currentRevision: 2, lastReadyRevision: 1, status: "failed" });
    expect((await store.getRevision(context, artifact.id, 1)).outputs).toEqual([output]);
  });
});
