// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { artifactFixture } from "./testing/fixture";
import { createArtifactJobs } from "./jobs";
import { createArtifactEvents } from "./events";

let f: Awaited<ReturnType<typeof artifactFixture>>;
let jobs: ReturnType<typeof createArtifactJobs>;
beforeAll(async () => { f = await artifactFixture(); jobs = createArtifactJobs(f.database, f.store); }, 30_000);
beforeEach(async () => { await f.pg.exec(`truncate "artifactRequests" cascade`); });
afterAll(async () => { await f.pg.close(); });
async function queued() {
  const { ctx, artifact } = await f.create();
  await f.store.writeArtifactFiles(ctx, artifact.id, 0, { "deck.json": "{}" });
  const job = await jobs.enqueueArtifactJob(ctx, artifact.id, 1, "export", { formats: ["pdf"] });
  return { ctx, artifact, job };
}

describe("durable job ownership", () => {
  it("repeated enqueue of the same sealed input has one job", async () => {
    const { ctx, artifact, job } = await queued();
    expect((await jobs.enqueueArtifactJob(ctx, artifact.id, 1, "export", { formats: ["pdf"] })).id).toBe(job.id);
    expect((await f.store.getRevision(ctx, artifact.id, 1)).sealedAt).not.toBeNull();
    const claims = await Promise.all([jobs.claimArtifactJob("one"), jobs.claimArtifactJob("two")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await jobs.getJob(ctx, job.id)).attempt).toBe(1);
  });

  it("recovers a crashed render with a new token and rejects the previous worker", async () => {
    const { ctx, job } = await queued();
    const before = (await jobs.claimArtifactJob("one"))!;
    await f.pg.query(`update "artifactJobs" set "leaseUntil"=now()-interval '1 second' where "id"=$1`, [job.id]);
    const after = (await jobs.claimArtifactJob("two"))!;
    expect(after.job.id).toBe(job.id);
    expect(after.fencingToken).not.toBe(before.fencingToken);
    await expect(jobs.advance(before, "validating")).rejects.toMatchObject({ code: "lease_lost" });
    await jobs.advance(after, "validating");
    expect((await jobs.getJob(ctx, job.id)).status).toBe("validating");
  });

  it("does not replay an ambiguous paid call after a crash", async () => {
    const { ctx, job } = await queued();
    const claim = (await jobs.claimArtifactJob("one"))!;
    await jobs.startExternalCall(claim);
    await f.pg.query(`update "artifactJobs" set "leaseUntil"=now()-interval '1 second' where "id"=$1`, [job.id]);
    expect(await jobs.claimArtifactJob("two")).toBeNull();
    expect(await jobs.getJob(ctx, job.id)).toMatchObject({ status: "needs_attention", errorCode: "external_outcome_unknown", attempt: 1 });
  });

  it("cancels queued work without ever invoking an adapter", async () => {
    const { ctx, job } = await queued();
    await jobs.cancelArtifactJob(ctx, job.id);
    expect((await jobs.getJob(ctx, job.id)).status).toBe("cancelled");
    expect(await jobs.claimArtifactJob("worker")).toBeNull();
  });

  it("settles cancellation after a worker dies before acknowledging it", async () => {
    const { ctx, job } = await queued();
    await jobs.claimArtifactJob("dead-worker");
    await jobs.cancelArtifactJob(ctx, job.id);
    await f.pg.query(`update "artifactJobs" set "leaseUntil"=now()-interval '1 second' where "id"=$1`, [job.id]);
    expect(await jobs.claimArtifactJob("replacement")).toBeNull();
    expect((await jobs.getJob(ctx, job.id)).status).toBe("cancelled");
  });

  it("retains earlier formats when a second export of the same revision finishes", async () => {
    const { ctx, artifact } = await queued();
    const first = (await jobs.claimArtifactJob("worker"))!;
    const complete = async (claim: NonNullable<typeof first>, format: string) => {
      await jobs.advance(claim, "validating"); await jobs.advance(claim, "storing");
      await f.store.recordArtifactResult(claim, { outputs: [{ key: `${format}/result`, format, mime: "application/octet-stream", bytes: 1, hash: "a".repeat(64) }], evidence: { valid: true, checks: [format], checkedAt: new Date().toISOString() } });
    };
    await complete(first, "pdf");
    await jobs.enqueueArtifactJob(ctx, artifact.id, 1, "export", { formats: ["pptx"] });
    const second = (await jobs.claimArtifactJob("worker"))!;
    await complete(second, "pptx");
    const revision = await f.store.getRevision(ctx, artifact.id, 1);
    expect(revision.outputs.map((o) => o.format)).toEqual(["pdf", "pptx"]);
    await complete(second, "pptx").catch(() => undefined);
    expect((await f.store.getRevision(ctx, artifact.id, 1)).outputs).toHaveLength(2);
  });

  it("a running cancellation prevents storing or completing a result", async () => {
    const { ctx, job } = await queued();
    const claim = (await jobs.claimArtifactJob("worker"))!;
    await jobs.cancelArtifactJob(ctx, job.id);
    expect(await jobs.heartbeat(claim)).toBe(false);
    await expect(jobs.advance(claim, "validating")).rejects.toMatchObject({ code: "lease_lost" });
    await jobs.finish(claim, "cancelled", "user_cancelled");
    expect((await jobs.getJob(ctx, job.id)).status).toBe("cancelled");
  });

  it("rechecks the actor's membership before starting queued work", async () => {
    const { ctx, artifact } = await f.create();
    const editor = { ...ctx, actorId: "editor", role: "editor" as const };
    await f.store.writeArtifactFiles(editor, artifact.id, 0, { "deck.json": "{}" });
    const job = await jobs.enqueueArtifactJob(editor, artifact.id, 1, "export", {});
    await f.pg.query(`delete from "projectMembers" where "userId"='editor'`);
    expect(await jobs.claimArtifactJob("worker")).toBeNull();
    expect(await jobs.getJob(ctx, job.id)).toMatchObject({ status: "failed", errorCode: "access_revoked" });
    await f.pg.query(`insert into "projectMembers" values ('project','editor','editor')`);
  });

  it("acknowledges monotonic event cursors per person without marking someone else's events read", async () => {
    const { ctx, job } = await queued();
    const events = createArtifactEvents(f.database);
    await jobs.cancelArtifactJob(ctx, job.id);
    const list = await events.listArtifactEvents(ctx, "0");
    expect(list.some((e) => e.type === "cancelled")).toBe(true);
    const cursor = list.at(-1)!.cursor;
    await events.acknowledge(ctx, cursor);
    await events.acknowledge(ctx, "0");
    expect(await events.lastRead(ctx)).toBe(cursor);
    expect(await events.lastRead({ ...ctx, actorId: "reader", role: "lector" })).toBe("0");
    expect(await events.listArtifactEvents(ctx, cursor)).toEqual([]);
  });
});
