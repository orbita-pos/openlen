// @vitest-environment node
import {afterAll,beforeAll,expect,it} from "vitest";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {artifactFixture} from "./testing/fixture";
import {createArtifactJobs} from "./jobs";
import {createArtifactBilling} from "./billing";
import {runArtifactJob} from "./worker";
import {resolveArtifactAssets} from "./assets";
import {availableArtifactKinds} from "./capabilities";
import {createArtifactAdapters} from "./adapters";
import {renderAudio} from "./adapters/audio/render";
import {pcmToWav} from "./adapters/audio/pcm";
import {createArtifactAgent,artifactToolDeclarations} from "./tools";
import {createArtifactData} from "./data";
import type {ArtifactAdapter} from "./types";
let f:Awaited<ReturnType<typeof artifactFixture>>;
beforeAll(async()=>{f=await artifactFixture();await f.pg.exec(`alter table "users" add column "credits" integer not null default 1000;alter table "users" add column "plan" text not null default 'pro';create table "creditLedger"("id" text primary key,"userId" text,"plan" text,"actorId" text,"projectId" text,"surface" text,"refId" text,"centicredits" integer,"listCenticredits" integer,"costMicroUsd" bigint,"provider" text,"model" text,"inputTokens" integer,"outputTokens" integer,"balanceAfter" integer,"outcome" text);`);},30_000);
afterAll(async()=>{await f.pg.close();});
it("advertises/wires audio only with explicit renderer verification, key and independent price",()=>{
  const env={OPENLEN_ARTIFACTS:"1",OPENAI_API_KEY:"test",OPENLEN_ARTIFACT_RENDERER_IMAGE:"openlen/renderer:1",OPENLEN_ARTIFACT_IMAGE_CENTICREDITS:"500",OPENLEN_ARTIFACT_RENDER_CENTICREDITS:"0",OPENLEN_ARTIFACT_AUDIO_CENTICREDITS:"25",OPENLEN_ARTIFACT_AUDIO_VERIFIED:"1"};
  expect(availableArtifactKinds(env)).toContain("audio");expect(createArtifactAdapters(env).audio).toBeTypeOf("function");
  for(const missing of ["OPENLEN_ARTIFACT_AUDIO_VERIFIED","OPENAI_API_KEY","OPENLEN_ARTIFACT_AUDIO_CENTICREDITS","OPENLEN_ARTIFACT_RENDERER_IMAGE"]){const bad={...env,[missing]:undefined};expect(availableArtifactKinds(bad)).not.toContain("audio");expect(createArtifactAdapters(bad).audio).toBeUndefined();}
});
it("lists only project-authorized upload identities and checks their hash before resolving exact audio refs",async()=>{
  const wav=pcmToWav(new Uint8Array(48000)).wav,hash=createHash("sha256").update(wav).digest("hex"),filename=`${hash}.wav`;
  const calls:string[]=[];
  const uploads={listAudio:async(projectId:string)=>{calls.push(projectId);return [{filename,contentType:"audio/wav",size:wav.length,url:"private URL is not returned",uploadedAt:0}];},get:async(projectId:string,name:string,maxBytes?:number)=>{expect(projectId).toBe("project");expect(name).toBe(filename);expect(maxBytes).toBe(20*1024*1024);return {contents:Buffer.from(wav),contentType:"audio/wav"};}};
  const services={database:f.database,store:f.store,jobs:createArtifactJobs(f.database,f.store),data:createArtifactData(f.database,f.store,async()=>null),captureContext:async()=>{throw Error("not requested");},audioUploads:uploads};
  const agent=createArtifactAgent(services,f.owner,()=>"audio-list",["audio"]);
  expect(artifactToolDeclarations(["audio"]).some(t=>t.name==="list_artifact_audio")).toBe(true);
  expect((await agent.execute("list_artifact_audio",{projectId:"other"})).response).toMatchObject({ok:true,assets:[{id:`upload:${filename}`,bytes:wav.length}]});expect(calls).toEqual(["project"]);
  expect((await createArtifactAgent(services,{...f.owner,actorId:"stranger",role:"lector"},()=>"bad",["audio"]).execute("list_artifact_audio",{})).response.ok).toBe(false);expect(calls).toHaveLength(1);
  const revision={dependencies:[],files:{"audio.json":JSON.stringify({version:1,durationSeconds:1,tracks:[{asset:`upload:${filename}`} ]})}};
  expect(await resolveArtifactAssets(f.owner,revision,f.store,{} as never,uploads,f.database)).toEqual([{id:`upload:${filename}`,mime:"audio/wav",bytes:new Uint8Array(wav)}]);
  await expect(resolveArtifactAssets(f.owner,revision,f.store,{} as never,{...uploads,get:async()=>({contents:Buffer.from("corrupt"),contentType:"audio/wav"})},f.database)).rejects.toMatchObject({code:"asset_corrupt"});
});
it("saves real mixed outputs, settles once, and reuses exact narration in a video job without another provider call",async()=>{
  const {ctx,artifact}=await f.create("project","audio"),jobs=createArtifactJobs(f.database,f.store),billing=createArtifactBilling(f.database,{imageCenticredits:500,renderCenticredits:0,audioCenticredits:25});
  await f.store.writeArtifactFiles(ctx,artifact.id,0,{"audio.json":JSON.stringify({version:1,speech:{text:"Mi app",voice:"coral"}})});
  await jobs.enqueueArtifactJob(ctx,artifact.id,1,"export",{formats:["mp3","wav"]});
  let calls=0;const objects=new Map<string,Uint8Array>(),storage={put:async(k:string,v:Uint8Array)=>{objects.set(k,v);},get:async(k:string)=>objects.get(k)!,delete:async(k:string)=>{objects.delete(k);}};
  const dir=await mkdtemp(join(tmpdir(),"len-audio-worker-"));
  try{
    const audio:ArtifactAdapter=(input,signal,hooks)=>renderAudio(input,{model:"gpt-4o-mini-tts-2025-12-15",transport:async()=>{calls++;return {model:"gpt-4o-mini-tts-2025-12-15",requestId:"req_test",outcome:"succeeded",usage:null,costMicroUsd:null,pcm:new Uint8Array(48000)};}},async packet=>{
      if(packet.kind!=="audio")throw Error("wrong kind");const {mixAudioTracks}=await import("../../tools/artifact-renderer/audio.mjs");
      return {png:new Uint8Array(),audio:await mixAudioTracks(packet.audio,dir),mp3:await readFile(join(dir,"audio.mp3")),wav:await readFile(join(dir,"audio.wav")),checks:["audio:decoded","audio:duration-checked","audio:stereo-48000","audio:mp3-wav"]};
    },signal,hooks);
    const claim=(await jobs.claimArtifactJob("voice-worker"))!;
    expect(await runArtifactJob(claim,{database:f.database,store:f.store,jobs,storage,billing,adapters:{audio}},new AbortController().signal)).toMatchObject({status:"completed"});
    const saved=await f.store.getRevision(ctx,artifact.id,1);expect(saved.outputs.map(x=>x.format)).toEqual(["mp3","wav","wav","json"]);
    const agent=createArtifactAgent({database:f.database,store:f.store,jobs,data:createArtifactData(f.database,f.store,async()=>null),captureContext:async()=>{throw Error("not requested");}},ctx,()=>"inspect-audio",["audio"]);
    expect((await agent.execute("inspect_artifact",{artifact_id:artifact.id})).response).toMatchObject({ok:true,evidence:{checks:expect.arrayContaining(["audio:durationSeconds:1","voice:ai-generated"])}});
    expect((await f.database.query(`select "surface","centicredits","costMicroUsd" from "creditLedger" where "refId"=$1`,[claim.job.id]))[0]).toMatchObject({surface:"artifact_audio",centicredits:25,costMicroUsd:null});
    await jobs.enqueueArtifactJob(ctx,artifact.id,1,"export",{formats:["mp3","wav"]});expect(await jobs.claimArtifactJob("again")).toBeNull();
    const video=await f.store.createArtifact(ctx,{kind:"motion",title:"Narrated video",brief:"Reuse voice",visibility:"project"});
    await f.store.writeArtifactFiles(ctx,video.id,0,{"motion.json":JSON.stringify({audio:{tracks:[{asset:`${artifact.id}@1/2`,role:"narration"}]}})},{dependencies:[{artifactId:artifact.id,revision:1}]});
    await jobs.enqueueArtifactJob(ctx,video.id,1,"export",{});
    const next=(await jobs.claimArtifactJob("video-worker"))!;
    const outcome=await runArtifactJob(next,{database:f.database,store:f.store,jobs,storage,billing,adapters:{motion:async input=>{
      expect(input.assets).toHaveLength(1);expect(input.assets[0]!.id).toBe(`${artifact.id}@1/2`);expect(input.assets[0]!.bytes).toEqual(pcmToWav(new Uint8Array(48000)).wav);
      return {outputs:[{name:"reuse-proof.txt",format:"txt",mime:"text/plain",bytes:new TextEncoder().encode("exact narration reused")}],evidence:{valid:true,checkedAt:new Date().toISOString(),checks:["reuse:exact-audio"]}};
    }}},new AbortController().signal);
    expect(outcome.status).toBe("completed");expect(calls).toBe(1);
  }finally{await rm(dir,{recursive:true,force:true});}
},30_000);
it.each(["timeout","cancel"])("does not replay or charge successful speech after a %s with an ambiguous provider outcome",async mode=>{
  const {ctx,artifact}=await f.create("project","audio"),jobs=createArtifactJobs(f.database,f.store),billing=createArtifactBilling(f.database,{imageCenticredits:500,renderCenticredits:0,audioCenticredits:25});
  await f.store.writeArtifactFiles(ctx,artifact.id,0,{"audio.json":JSON.stringify({version:1,speech:{text:"Hola"}})});
  await jobs.enqueueArtifactJob(ctx,artifact.id,1,"export",{formats:["mp3"]});const claim=(await jobs.claimArtifactJob("uncertain-voice"))!;
  const controller=new AbortController();let calls=0;
  const audio:ArtifactAdapter=(input,signal,hooks)=>renderAudio(input,{model:"gpt-4o-mini-tts-2025-12-15",transport:async()=>{calls++;if(mode==="cancel")controller.abort();return {model:"gpt-4o-mini-tts-2025-12-15",outcome:"unknown",requestId:null,usage:null,costMicroUsd:null,code:"audio_outcome_unknown"};}},async()=>{throw Error("no mix");},signal,hooks);
  expect(await runArtifactJob(claim,{database:f.database,store:f.store,jobs,storage:{} as never,billing,adapters:{audio}},controller.signal)).toMatchObject({status:"needs_attention",code:"external_outcome_unknown"});
  await jobs.enqueueArtifactJob(ctx,artifact.id,1,"export",{formats:["mp3"]});expect(await jobs.claimArtifactJob("replacement")).toBeNull();expect(calls).toBe(1);
  expect((await f.database.query(`select "centicredits","outcome" from "creditLedger" where "refId"=$1`,[claim.job.id]))[0]).toMatchObject({centicredits:0,outcome:"error"});
});
it("does not reclaim an expired audio lease after speech admission survived a worker crash",async()=>{
  const {ctx,artifact}=await f.create("project","audio"),jobs=createArtifactJobs(f.database,f.store),billing=createArtifactBilling(f.database,{imageCenticredits:500,renderCenticredits:0,audioCenticredits:25});
  await f.store.writeArtifactFiles(ctx,artifact.id,0,{"audio.json":"{}"});const job=await jobs.enqueueArtifactJob(ctx,artifact.id,1,"export",{}),claim=(await jobs.claimArtifactJob("dead-voice"))!;
  await billing.startAttempt(claim,ctx,"audio","gpt-4o-mini-tts-2025-12-15");await f.database.query(`update "artifactJobs" set "leaseUntil"=now()-interval '1 second' where "id"=$1`,[job.id]);
  expect(await jobs.claimArtifactJob("replacement")).toBeNull();expect(await jobs.getJob(ctx,job.id)).toMatchObject({status:"needs_attention",attempt:1,errorCode:"external_outcome_unknown"});
});
