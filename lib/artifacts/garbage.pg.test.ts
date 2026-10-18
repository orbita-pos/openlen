// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { artifactFixture } from "./testing/fixture";
import { createArtifactJobs } from "./jobs";
import { collectArtifactGarbage } from "./garbage";
import { runArtifactJob } from "./worker";

let f: Awaited<ReturnType<typeof artifactFixture>>;
beforeAll(async () => { f = await artifactFixture(); }, 30_000);
beforeEach(async () => { await f.pg.exec(`truncate "artifactRequests" cascade; truncate "artifactObjectGarbage";`); });
afterAll(async () => { await f.pg.close(); });
async function render(failAfterWrite = false) {
  const { ctx, artifact } = await f.create();
  const jobs = createArtifactJobs(f.database, f.store);
  await f.store.writeArtifactFiles(ctx, artifact.id, 0, { "deck.json": "{}" });
  await jobs.enqueueArtifactJob(ctx, artifact.id, 1, "export", {});
  const claim = (await jobs.claimArtifactJob("worker"))!;
  const objects = new Map<string, Uint8Array>();
  const storage = { put: async (key: string, bytes: Uint8Array) => { objects.set(key, bytes); if (failAfterWrite) throw new Error("lost upload response"); }, get: async (key: string) => objects.get(key)!, delete: async (key: string) => { objects.delete(key); } };
  const result = await runArtifactJob(claim, { database: f.database, store: f.store, jobs, storage, adapters: { slides: async () => ({ outputs: [{ name: "out.txt", format: "txt", mime: "text/plain", bytes: new Uint8Array([1, 2]) }], evidence: { valid: true, checks: ["bytes decoded"], checkedAt: new Date().toISOString() } }) } }, new AbortController().signal);
  return { objects, storage, result, artifact };
}
describe("durable private object cleanup", () => {
  it("tracks a successful upload whose response was lost, and later cleans the unreferenced object", async () => {
    const r = await render(true);
    expect(r.result.status).toBe("failed");
    expect(r.objects.size).toBe(1);
    expect(await collectArtifactGarbage(f.database, r.storage)).toBe(0);
    await f.pg.query(`update "artifactObjectGarbage" set "notBefore"=now()-interval '1 second'`);
    expect(await collectArtifactGarbage(f.database, r.storage)).toBe(1);
    expect(r.objects.size).toBe(0);
  });
  it("never removes outputs referenced by a ready revision", async () => {
    const r = await render();
    await f.pg.query(`update "artifactObjectGarbage" set "notBefore"=now()-interval '1 second'`);
    expect(await collectArtifactGarbage(f.database, r.storage)).toBe(0);
    expect(r.objects.size).toBe(1);
  });
  it("cleanup records survive project deletion and remove its private outputs", async () => {
    const r = await render();
    await f.pg.query(`delete from "projects" where "id"='project'`);
    await f.pg.query(`update "artifactObjectGarbage" set "notBefore"=now()-interval '1 second'`);
    expect(await collectArtifactGarbage(f.database, r.storage)).toBe(1);
    expect(r.objects.size).toBe(0);
    await f.pg.query(`insert into "projects" values ('project','owner')`);
  });
});
