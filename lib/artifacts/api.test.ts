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
  it("keeps new deliverables visible after more than 200 have been created",async()=>{
    const {ctx,artifact}=await f.create();
    await f.database.query(`insert into "artifacts" ("id","projectId","requestId","kind","title","brief","createdBy","visibility","createdAt") select $1||'-'||i,$2,$3,'image','Fixture','Fixture','owner','project','2040-01-01T00:00:00Z'::timestamptz+i*interval '1 second' from generate_series(1,201) i`,[artifact.id,ctx.projectId,ctx.requestId]);
    await f.database.query(`insert into "artifactRevisions" ("artifactId","revision") select id,0 from "artifacts" where id like $1`,[artifact.id+"-%"]);
    const services={database:f.database,store:f.store,jobs:createArtifactJobs(f.database,f.store),events:createArtifactEvents(f.database),storage:async()=>{throw Error("not needed");}};
    const response=await handleArtifactApi(services,ctx,new Request("https://openlen.test/api/artifacts"),{action:"list"},true);
    const result=await response.json();
    expect(result.artifacts).toHaveLength(200);
    expect(result.artifacts[0].id).toBe(`${artifact.id}-201`);
  });
  it("includes the latest jobs after a long revision history",async()=>{
    const {ctx,artifact}=await f.create();
    await f.database.query(`insert into "artifactJobs" ("id","artifactId","revision","operation","optionsHash","status","createdAt") select $1||'-'||i,$1,0,'export',i::text,'cancelled','2026-10-19T00:00:00Z'::timestamptz+i*interval '1 second' from generate_series(1,101) i`,[artifact.id]);
    const services={database:f.database,store:f.store,jobs:createArtifactJobs(f.database,f.store),events:createArtifactEvents(f.database),storage:async()=>{throw Error("not needed");}};
    const response=await handleArtifactApi(services,ctx,new Request("https://openlen.test/api/artifacts"),{action:"inspect",artifactId:artifact.id},true);
    const result=await response.json();
    expect(result.jobs).toHaveLength(100);
    expect(result.jobs.some((job:{id:string})=>job.id===`${artifact.id}-101`)).toBe(true);
  });
  it("inspects an exact previous ready revision while new sources remain a draft", async () => {
    const {ctx,artifact}=await f.create();
    await f.store.writeArtifactFiles(ctx,artifact.id,0,{"deck.json":"{}"});
    await f.store.sealArtifactRevision(ctx,artifact.id,1);
    await f.database.query(`update "artifactRevisions" set "outputs"=$3::jsonb,"evidence"=$4::jsonb where "artifactId"=$1 and "revision"=$2`,[artifact.id,1,JSON.stringify([{key:"private/ready.html",hash:"a".repeat(64),mime:"text/html",format:"html",bytes:20}]),JSON.stringify({valid:true})]);
    await f.database.query(`update "artifacts" set "lastReadyRevision"=1 where id=$1`,[artifact.id]);
    await f.store.writeArtifactFiles(ctx,artifact.id,1,{"deck.json":"{\"updated\":true}"});
    const services={database:f.database,store:f.store,jobs:createArtifactJobs(f.database,f.store),events:createArtifactEvents(f.database),storage:async()=>{throw Error("not needed");}};
    const response=await handleArtifactApi(services,ctx,new Request("https://openlen.test/api/artifacts?revision=1"),{action:"inspect",artifactId:artifact.id},true);
    const result=await response.json();
    expect(result.artifact.currentRevision).toBe(2);
    expect(result.revision.revision).toBe(1);
    expect(result.revision.outputs[0]).toMatchObject({index:0,name:"ready.html",format:"html"});
    expect((await handleArtifactApi(services,ctx,new Request("https://openlen.test/api/artifacts?revision=bad"),{action:"inspect",artifactId:artifact.id},true)).status).toBe(400);
    expect((await handleArtifactApi(services,ctx,new Request("https://openlen.test/api/artifacts?revision=999"),{action:"inspect",artifactId:artifact.id},true)).status).toBe(404);
  });
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
