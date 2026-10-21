// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { artifactFixture } from "./testing/fixture";
import { createArtifactJobs } from "./jobs";
import { runArtifactJob } from "./worker";
import { ArtifactError, type ArtifactAdapter } from "./types";

let f: Awaited<ReturnType<typeof artifactFixture>>;
let jobs: ReturnType<typeof createArtifactJobs>;
beforeAll(async () => { f = await artifactFixture(); jobs = createArtifactJobs(f.database, f.store); }, 30_000);
beforeEach(async () => { await f.pg.exec(`truncate "artifactRequests" cascade`); });
afterAll(async () => { await f.pg.close(); });

describe("worker confirms persisted results", () => {
  async function run(adapter: ArtifactAdapter, failStorage = false, uncertainCommit = false) {
    const { ctx, artifact } = await f.create();
    await f.store.writeArtifactFiles(ctx, artifact.id, 0, { "deck.json": "{}" });
    const job = await jobs.enqueueArtifactJob(ctx, artifact.id, 1, "export", {});
    const claim = (await jobs.claimArtifactJob("worker"))!;
    const objects = new Map<string, Uint8Array>();
    const storage = { put: async (key: string, bytes: Uint8Array) => { if (failStorage) throw new Error("offline"); objects.set(key, bytes); }, get: async (key: string) => objects.get(key)!, delete: async (key: string) => { objects.delete(key); } };
    const store = uncertainCommit ? { ...f.store, recordArtifactResult: async (...args: Parameters<typeof f.store.recordArtifactResult>) => { await f.store.recordArtifactResult(...args); throw new Error("connection lost after commit"); } } : f.store;
    const result = await runArtifactJob(claim, { database: f.database, store, jobs, storage, adapters: { slides: adapter } }, new AbortController().signal);
    return { ctx, artifact, job, result, objects };
  }

  it("stores actual bytes before publishing a ready event, and they survive a fresh store read", async () => {
    const result = await run(async () => ({ outputs: [{ name: "result.txt", format: "txt", mime: "text/plain", bytes: new TextEncoder().encode("Slides ready") }], evidence: { valid: true, checks: ["text file decoded"], checkedAt: new Date().toISOString() } }));
    expect(result.result.status).toBe("completed");
    const revision = await f.store.getRevision(result.ctx, result.artifact.id, 1);
    expect(new TextDecoder().decode(result.objects.get(revision.outputs[0]!.key))).toBe("Slides ready");
    expect((await f.store.getArtifact(result.ctx, result.artifact.id)).lastReadyRevision).toBe(1);
    expect((await f.pg.query(`select * from "artifactEvents" where "type"='ready'`)).rows).toHaveLength(1);
  });

  it("never announces ready when storing fails", async () => {
    const result = await run(async () => ({ outputs: [{ name: "x.txt", format: "txt", mime: "text/plain", bytes: new Uint8Array([1]) }], evidence: { valid: true, checks: ["one byte"], checkedAt: new Date().toISOString() } }), true);
    expect(result.result.status).toBe("failed");
    expect((await f.store.getArtifact(result.ctx, result.artifact.id)).lastReadyRevision).toBeNull();
    expect((await f.pg.query(`select * from "artifactEvents" where "type"='ready'`)).rows).toHaveLength(0);
  });

  it("rejects empty exports and keeps the editable source", async () => {
    const result = await run(async () => ({ outputs: [], evidence: { valid: true, checks: ["claimed ready"], checkedAt: new Date().toISOString() } }));
    expect(result.result.status).toBe("failed");
    expect((await f.store.getRevision(result.ctx, result.artifact.id, 1)).files).toEqual({ "deck.json": "{}" });
    expect(result.objects.size).toBe(0);
  });

  it("keeps committed objects if the connection fails after the result transaction committed", async () => {
    const result = await run(async () => ({ outputs: [{ name: "done.txt", format: "txt", mime: "text/plain", bytes: new TextEncoder().encode("real") }], evidence: { valid: true, checks: ["text decoded"], checkedAt: new Date().toISOString() } }), false, true);
    expect(result.result.status).toBe("completed");
    const revision = await f.store.getRevision(result.ctx, result.artifact.id, 1);
    expect(new TextDecoder().decode(result.objects.get(revision.outputs[0]!.key))).toBe("real");
  });

  it("reports a cancellation made while the adapter runs as cancelled, not failed", async () => {
    const result = await run(async () => {
      await f.pg.query(`update "artifactJobs" set "cancelRequested"=true where "status"='running'`);
      return { outputs: [{ name: "x.txt", format: "txt", mime: "text/plain", bytes: new Uint8Array([1]) }], evidence: { valid: true, checks: ["file"], checkedAt: new Date().toISOString() } };
    });
    expect(result.result.status).toBe("cancelled");
    expect((await jobs.getJob(result.ctx, result.job.id)).status).toBe("cancelled");
  });

  it("keeps bounded compiler diagnostics with the failed job for a later inspect", async () => {
    const result = await run(async () => { throw new ArtifactError("artifact_compile_failed", "/main.ts:3: expected expression"); });
    expect(await jobs.getJob(result.ctx, result.job.id)).toMatchObject({ status: "failed", errorCode: "artifact_compile_failed", diagnostics: ["/main.ts:3: expected expression"] });
  });
  it("preserves actionable slide diagnostics for inspect and correction",async()=>{
    for(const [code,message] of [["slide_layout_unsupported","cover:4:1 <img>: overflow:hidden on cover:3:1 <div> clips it — PowerPoint cannot clip; keep it inside, or give an <img> its own border-radius"],["slide_format_invalid","slides/plan.html 3:1 <button>: not in the slide format — a <p> with background, padding and border-radius is a pill"]] as const){
      const result=await run(async()=>{throw new ArtifactError(code,message);});
      expect(await jobs.getJob(result.ctx,result.job.id)).toMatchObject({status:"failed",errorCode:code,diagnostics:[message]});
    }
  });

  it("keeps uncertain renderer cleanup actionable even when cancellation arrives at the same time", async () => {
    const result = await run(async () => {
      await f.pg.query(`update "artifactJobs" set "cancelRequested"=true where "status"='running'`);
      throw new ArtifactError("renderer_cleanup_unknown");
    });
    expect(result.result).toMatchObject({status:"needs_attention",code:"renderer_cleanup_unknown"});
    expect(await jobs.getJob(result.ctx,result.job.id)).toMatchObject({status:"needs_attention",errorCode:"renderer_cleanup_unknown"});
    expect((await f.pg.query(`select * from "artifactEvents" where "type"='ready'`)).rows).toHaveLength(0);
  });
});
