// @vitest-environment node
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { artifactFixture } from "./testing/fixture";
import { createArtifactJobs } from "./jobs";
import { createArtifactEvents } from "./events";
import { handleArtifactApi } from "./api";

let f: Awaited<ReturnType<typeof artifactFixture>>;
beforeAll(async () => { f = await artifactFixture(); }, 30_000);
afterAll(async () => { await f.pg.close(); });

describe("private artifact API", () => {
  it("feature-off and nonmembers cannot list deliverables", async () => {
    const services = { database: f.database, store: f.store, jobs: createArtifactJobs(f.database, f.store), events: createArtifactEvents(f.database), storage: async () => { throw new Error("not needed for metadata"); } };
    const req = new Request("https://openlen.test/api/artifacts");
    expect((await handleArtifactApi(services, f.owner, req, { action: "list" }, false)).status).toBe(404);
    expect((await handleArtifactApi(services, { ...f.owner, actorId: "stranger" }, req, { action: "list" }, true)).status).toBe(404);
  });

  it("downloads only saved files after current authorization and hides worker tokens", async () => {
    const { ctx, artifact } = await f.create();
    const jobs = createArtifactJobs(f.database, f.store);
    await f.store.writeArtifactFiles(ctx, artifact.id, 0, { "deck.json": "{}" });
    const job = await jobs.enqueueArtifactJob(ctx, artifact.id, 1, "export", {});
    const claim = (await jobs.claimArtifactJob("worker"))!;
    await jobs.advance(claim, "validating"); await jobs.advance(claim, "storing");
    const bytes = new TextEncoder().encode("Downloaded artifact");
    const output = { key: `project/${artifact.id}/result.txt`, hash: createHash("sha256").update(bytes).digest("hex"), mime: "text/plain", bytes: bytes.length, format: "txt" };
    await f.store.recordArtifactResult(claim, { outputs: [output], evidence: { valid: true, checks: ["text decoded"], checkedAt: new Date().toISOString() } });
    const services = { database: f.database, store: f.store, jobs, events: createArtifactEvents(f.database), storage: async () => ({ put: async () => {}, get: async () => bytes, delete: async () => {} }) };
    const request = new Request("https://openlen.test/api/artifacts?revision=1");
    const response = await handleArtifactApi(services, ctx, request, { action: "download", artifactId: artifact.id, index: "0" }, true);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Downloaded artifact");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const inspect = await handleArtifactApi(services, ctx, request, { action: "inspect", artifactId: artifact.id }, true);
    const metadata = await inspect.text();
    expect(metadata).not.toContain(claim.fencingToken);
    expect(metadata).toContain(job.id);
    expect((await handleArtifactApi(services, ctx, request, { action: "download", artifactId: artifact.id, index: "../secret" }, true)).status).toBe(400);
  });
});
