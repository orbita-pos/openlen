// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { artifactFixture } from "./testing/fixture";
import { createArtifactJobs } from "./jobs";
import { createArtifactBilling, artifactChargePolicy } from "./billing";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runArtifactJob } from "./worker";
import { generateArtifactImage } from "./adapters/image/render";
import { ARTIFACT_MIGRATION_SQL } from "./migration";
let f: Awaited<ReturnType<typeof artifactFixture>>;
beforeAll(async()=>{
  f=await artifactFixture();
  await f.pg.exec(`alter table "users" add column "credits" integer not null default 1000; alter table "users" add column "plan" text not null default 'pro'; create table "creditLedger"("id" text primary key,"userId" text,"plan" text,"actorId" text,"projectId" text,"surface" text,"refId" text,"centicredits" integer,"listCenticredits" integer,"costMicroUsd" bigint,"provider" text,"model" text,"inputTokens" integer,"outputTokens" integer,"balanceAfter" integer,"outcome" text);`);
  // The member limit's columns, as `npm run miembros:migrate` creates them.
  await f.pg.exec(`alter table "projects" add column "topeMensualMiembros" integer; create table "projectMemberSpend"("projectId" text not null,"userId" text not null,"mes" text not null,"creditos" integer not null default 0,primary key("projectId","userId","mes"));`);
},30_000);
beforeEach(async()=>{await f.pg.exec(`truncate "artifactSettlements","artifactAttempts","creditLedger","projectMemberSpend";truncate "artifactRequests" cascade;update "users" set "credits"=1000;update "projects" set "topeMensualMiembros"=null;`);});
const month=()=>new Date().toISOString().slice(0,7);
afterAll(async()=>{await f.pg.close();});
const policy={imageCenticredits:500,renderCenticredits:0};
it("adds audio idempotently and requires an independent explicit speech price before a paid attempt",async()=>{
  const {ctx,artifact}=await f.create("project","audio");
  await f.pg.exec(ARTIFACT_MIGRATION_SQL);
  expect((await f.store.getArtifact(ctx,artifact.id)).kind).toBe("audio");
  await f.store.writeArtifactFiles(ctx,artifact.id,0,{"audio.json":"{}"});
  const jobs=createArtifactJobs(f.database,f.store);await jobs.enqueueArtifactJob(ctx,artifact.id,1,"export",{});
  const claim=(await jobs.claimArtifactJob("voice-worker"))!;
  await expect(createArtifactBilling(f.database,policy).startAttempt(claim,ctx,"audio","gpt-4o-mini-tts-2025-12-15")).rejects.toMatchObject({code:"charge_policy_unavailable"});
  const billing=createArtifactBilling(f.database,{...policy,audioCenticredits:25});
  await billing.startAttempt(claim,ctx,"audio","gpt-4o-mini-tts-2025-12-15");
  expect((await f.database.query(`select "centicredits","kind" from "artifactAttempts" where "jobId"=$1`,[claim.job.id]))[0]).toMatchObject({kind:"audio",centicredits:25});
  expect(artifactChargePolicy({OPENLEN_ARTIFACT_IMAGE_CENTICREDITS:"500",OPENLEN_ARTIFACT_RENDER_CENTICREDITS:"0",OPENLEN_ARTIFACT_AUDIO_CENTICREDITS:"25"})).toMatchObject({audioCenticredits:25});
});
async function ready(){const {ctx,artifact}=await f.create("project","image");await f.store.writeArtifactFiles(ctx,artifact.id,0,{"image.json":"{}"});const jobs=createArtifactJobs(f.database,f.store);await jobs.enqueueArtifactJob(ctx,artifact.id,1,"export",{});return {ctx,artifact,jobs,claim:(await jobs.claimArtifactJob("worker"))!};}
const receipt={outcome:"succeeded" as const,model:"gpt-image-2",requestId:"req_test",usage:{input_tokens:10,output_tokens:100},costMicroUsd:12345};
const result={outputs:[{key:"private/output.png",hash:"a".repeat(64),bytes:10,mime:"image/png",format:"png"}],evidence:{valid:true as const,checkedAt:new Date().toISOString(),checks:["image decoded"]}};
it("requires explicit pricing and enough balance before recording a paid attempt",async()=>{
  expect(artifactChargePolicy({})).toBeNull();expect(artifactChargePolicy({OPENLEN_ARTIFACT_IMAGE_CENTICREDITS:"500",OPENLEN_ARTIFACT_RENDER_CENTICREDITS:"0"})).toEqual(policy);
  expect(artifactChargePolicy({OPENLEN_ARTIFACT_IMAGE_CENTICREDITS:"-1",OPENLEN_ARTIFACT_RENDER_CENTICREDITS:"0"})).toBeNull();
  const {ctx,claim}=await ready();await f.pg.exec(`update "users" set "credits"=100`);
  await expect(createArtifactBilling(f.database,policy).startAttempt(claim,ctx,"image","gpt-image-2")).rejects.toMatchObject({code:"insufficient_credits"});
  expect((await f.database.query(`select "externalStartedAt" from "artifactJobs" where "id"=$1`,[claim.job.id]))[0]!.externalStartedAt).toBeNull();
});
it("publishes bytes, charges balance and records one settlement atomically, including a repeated completion",async()=>{
  const {ctx,claim,jobs}=await ready();const billing=createArtifactBilling(f.database,policy);
  await billing.startAttempt(claim,ctx,"image","gpt-image-2");await billing.recordOutcome(claim,receipt);await billing.recordOutcome(claim,receipt);
  await jobs.advance(claim,"validating");await jobs.advance(claim,"storing");
  const settled={...result,settle:(tx:Parameters<Parameters<typeof f.database.transaction>[0]>[0])=>billing.settleArtifactAttempt(tx,claim).then(()=>{})};
  await f.store.recordArtifactResult(claim,settled);await f.store.recordArtifactResult(claim,settled);
  expect((await f.database.query(`select "credits" from "users" where "id"='owner'`))[0]!.credits).toBe(500);
  expect(await f.database.query(`select * from "creditLedger"`)).toHaveLength(1);expect(await f.database.query(`select * from "artifactSettlements"`)).toHaveLength(1);
  expect((await f.database.query(`select * from "creditLedger"`))[0]).toMatchObject({centicredits:500,costMicroUsd:12345,refId:claim.job.id});
});
it("rolls a charge back if the result transaction fails, then recovers without a second provider attempt",async()=>{
  const {ctx,claim,jobs}=await ready();const billing=createArtifactBilling(f.database,policy);
  await billing.startAttempt(claim,ctx,"image","gpt-image-2");await billing.recordOutcome(claim,receipt);await jobs.advance(claim,"validating");await jobs.advance(claim,"storing");
  await expect(f.store.recordArtifactResult(claim,{...result,settle:async(tx)=>{await billing.settleArtifactAttempt(tx,claim);throw new Error("crash");}})).rejects.toThrow("crash");
  expect((await f.database.query(`select "credits" from "users" where "id"='owner'`))[0]!.credits).toBe(1000);expect(await f.database.query(`select * from "creditLedger"`)).toHaveLength(0);
  await f.store.recordArtifactResult(claim,{...result,settle:async(tx)=>{await billing.settleArtifactAttempt(tx,claim);}});
  expect(await f.database.query(`select * from "artifactAttempts"`)).toHaveLength(1);expect(await f.database.query(`select * from "creditLedger"`)).toHaveLength(1);
});
it("records failed provider cost once, charges zero and leaves unknown cost null",async()=>{
  const {ctx,claim}=await ready();const billing=createArtifactBilling(f.database,policy);
  await billing.startAttempt(claim,ctx,"image","gpt-image-2");await billing.recordOutcome(claim,{...receipt,outcome:"failed"});await billing.recordFailure(claim);await billing.recordFailure(claim);
  expect((await f.database.query(`select * from "creditLedger"`))[0]).toMatchObject({centicredits:0,costMicroUsd:12345});expect(await f.database.query(`select * from "creditLedger"`)).toHaveLength(1);
  await expect(billing.recordOutcome(claim,{...receipt,costMicroUsd:null})).rejects.toMatchObject({code:"external_receipt_conflict"});
});

it("blocks an unpriced call and leaves an ambiguous paid result for attention without automatically replaying it",async()=>{
  const {claim,jobs}=await ready();let calls=0;
  const storage={put:async()=>{},get:async()=>new Uint8Array(),delete:async()=>{}};
  const adapter:import("./types").ArtifactAdapter=async(_input,_signal,hooks)=>{await hooks.beforeExternalCall("gpt-image-2");calls++;await hooks.recordExternalOutcome({...receipt,outcome:"unknown",costMicroUsd:null,usage:null});throw new Error("unknown");};
  const deps={database:f.database,store:f.store,jobs,storage,adapters:{image:adapter}};
  expect(await runArtifactJob(claim,deps,new AbortController().signal)).toMatchObject({status:"failed",code:"charge_policy_unavailable"});expect(calls).toBe(0);
  const next=await ready();const billing=createArtifactBilling(f.database,policy);
  expect(await runArtifactJob(next.claim,{...deps,jobs:next.jobs,billing},new AbortController().signal)).toMatchObject({status:"needs_attention",code:"external_outcome_unknown"});expect(calls).toBe(1);
  expect(await jobs.claimArtifactJob("replacement")).toBeNull();
  expect((await f.database.query(`select * from "creditLedger"`))[0]).toMatchObject({centicredits:0,costMicroUsd:null});
});

it("stores two independent image identities, preserves the first on a partial failure and reuses it without another provider call",async()=>{
  const {ctx,artifact:first}=await f.create("project","image");
  const second=await f.store.createArtifact(ctx,{kind:"image",title:"Image two",brief:"Promotion",visibility:"project",itemKey:"image_2"});
  const spec=JSON.stringify({version:1,prompt:"Promotion",width:1024,height:1024,format:"png",quality:"medium",references:[]});
  const jobs=createArtifactJobs(f.database,f.store),billing=createArtifactBilling(f.database,policy);
  for(const a of [first,second]){await f.store.writeArtifactFiles(ctx,a.id,0,{"image.json":spec});await jobs.enqueueArtifactJob(ctx,a.id,1,"export",{formats:["png"]});}
  const native=createRequire(import.meta.url)("@openlen/images") as typeof import("@openlen/images");
  const generatedFixture=await native.processImage({input:await readFile(new URL("../../public/icon-512.png",import.meta.url)),variants:[{width:1024,format:"png",quality:100}],withoutEnlargement:false});
  const bytes=generatedFixture.variants[0]!.bytes;
  const objects=new Map<string,Uint8Array>();const storage={put:async(key:string,data:Uint8Array)=>{objects.set(key,data);},get:async(key:string)=>objects.get(key)!,delete:async(key:string)=>{objects.delete(key);}};
  let calls=0;
  const adapter:import("./types").ArtifactAdapter=(input,signal,hooks)=>generateArtifactImage(input,{model:"gpt-image-2",transport:async()=>{calls++;return input.artifact.id===first.id?{...receipt,bytes}:{...receipt,outcome:"failed",code:"image_response_incomplete"};}},signal,hooks);
  const outcomes=[];
  for(let i=0;i<2;i++){const claim=(await jobs.claimArtifactJob("worker"))!;outcomes.push(await runArtifactJob(claim,{database:f.database,store:f.store,jobs,storage,adapters:{image:adapter},billing},new AbortController().signal));}
  expect(outcomes.map(o=>o.status).sort()).toEqual(["completed","failed"]);expect(calls).toBe(2);
  expect((await f.store.getArtifact(ctx,first.id)).lastReadyRevision).toBe(1);expect((await f.store.getArtifact(ctx,second.id)).lastReadyRevision).toBeNull();
  expect((await f.database.query(`select "credits" from "users" where "id"='owner'`))[0]!.credits).toBe(500);
  expect(await f.database.query(`select * from "creditLedger" where "centicredits"=0`)).toHaveLength(1);
  const duplicate=await jobs.enqueueArtifactJob(ctx,first.id,1,"export",{formats:["png"]});expect(duplicate.status).toBe("completed");expect(await jobs.claimArtifactJob("worker")).toBeNull();
  const slides=await f.store.createArtifact(ctx,{kind:"slides",title:"Reuse image",brief:"Deck",visibility:"project"});
  await f.store.writeArtifactFiles(ctx,slides.id,0,{"deck.json":"{}"},{dependencies:[{artifactId:first.id,revision:1}]});await jobs.enqueueArtifactJob(ctx,slides.id,1,"export",{});
  const slideClaim=(await jobs.claimArtifactJob("worker"))!;
  const outcome=await runArtifactJob(slideClaim,{database:f.database,store:f.store,jobs,storage,adapters:{slides:async input=>{expect(input.assets).toHaveLength(1);expect(input.assets[0]!.id).toBe(`${first.id}@1/0`);expect(Buffer.from(input.assets[0]!.bytes).equals(bytes)).toBe(true);return {outputs:[{name:"proof.txt",format:"txt",mime:"text/plain",bytes:new TextEncoder().encode("Reused") }],evidence:result.evidence};}}},new AbortController().signal);
  expect(outcome.status).toBe("completed");expect(calls).toBe(2);
},30_000);

it("keeps a member inside the project's monthly member limit, counting attempts that were never settled", async () => {
  await f.pg.exec(`update "projects" set "topeMensualMiembros"=1200 where "id"='project'`);
  await f.database.query(`insert into "projectMemberSpend" values ('project','editor',$1,300)`, [month()]);
  const billing = createArtifactBilling(f.database, policy);
  const first = await ready();
  const member = { ...first.ctx, actorId: "editor", role: "editor" as const };
  await billing.startAttempt(first.claim, member, "image", "gpt-image-2");
  // The worker dies after the provider call: the attempt stays unsettled (needs_attention).
  await f.database.query(`update "artifactJobs" set "leaseUntil"=now()-interval '1 minute' where "id"=$1`, [first.claim.job.id]);
  const second = await ready();
  await expect(billing.startAttempt(second.claim, { ...second.ctx, actorId: "editor", role: "editor" }, "image", "gpt-image-2")).rejects.toMatchObject({ code: "member_limit_reached" });
  expect((await f.database.query(`select "externalStartedAt" from "artifactJobs" where "id"=$1`, [second.claim.job.id]))[0]!.externalStartedAt).toBeNull();
  // The limit is for members only: the owner pays for their own work.
  await billing.startAttempt(second.claim, second.ctx, "image", "gpt-image-2");
});

it("adds a member's settled charge to the month's member spend in the same transaction", async () => {
  const { ctx, claim, jobs } = await ready();
  const member = { ...ctx, actorId: "editor", role: "editor" as const };
  const billing = createArtifactBilling(f.database, policy);
  await billing.startAttempt(claim, member, "image", "gpt-image-2"); await billing.recordOutcome(claim, receipt);
  await jobs.advance(claim, "validating"); await jobs.advance(claim, "storing");
  await expect(f.store.recordArtifactResult(claim, { ...result, settle: async (tx) => { await billing.settleArtifactAttempt(tx, claim); throw new Error("crash"); } })).rejects.toThrow("crash");
  expect(await f.database.query(`select * from "projectMemberSpend"`)).toHaveLength(0);
  await f.store.recordArtifactResult(claim, { ...result, settle: async (tx) => { await billing.settleArtifactAttempt(tx, claim); } });
  expect(await f.database.query(`select "projectId","userId","mes","creditos" from "projectMemberSpend"`)).toEqual([{ projectId: "project", userId: "editor", mes: month(), creditos: 500 }]);
  // The owner's own charge is not member spend.
  const own = await ready();
  await billing.startAttempt(own.claim, own.ctx, "image", "gpt-image-2"); await billing.recordOutcome(own.claim, receipt);
  await own.jobs.advance(own.claim, "validating"); await own.jobs.advance(own.claim, "storing");
  await f.store.recordArtifactResult(own.claim, { ...result, settle: async (tx) => { await billing.settleArtifactAttempt(tx, own.claim); } });
  expect(await f.database.query(`select "userId","creditos" from "projectMemberSpend"`)).toEqual([{ userId: "editor", creditos: 500 }]);
});
