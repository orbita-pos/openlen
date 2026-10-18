// @vitest-environment node
import {afterAll,beforeAll,expect,it} from "vitest";
import {artifactFixture} from "./testing/fixture";
import {createArtifactJobs} from "./jobs";
import {createArtifactStore} from "./store";
import {createArtifactEvents} from "./events";
import {runArtifactJob} from "./worker";
import {ArtifactError,type ArtifactAdapter,type ArtifactKind} from "./types";

let f:Awaited<ReturnType<typeof artifactFixture>>;
beforeAll(async()=>{f=await artifactFixture();},30_000);
afterAll(async()=>{await f.pg.close();});

// Infrastructure acceptance only. These injected adapters deliberately produce
// small fixture files, not claims of model selection, paid images or MP4/PPTX
// fidelity. Real format/provider/daemon acceptance has separate gates.
it("keeps five durable identities, continues independent pieces, pins reused assets and preserves ready pieces through a failed video and reconnect",async()=>{
  const request=await f.store.ensureArtifactRequest(f.owner,"one-human-request");
  const ctx={...f.owner,requestId:request.id};
  const pieces=new Map<string,Awaited<ReturnType<typeof f.store.createArtifact>>>();
  for(const [itemKey,kind] of [["video","motion"],["dashboard","dashboard"],["slides","slides"],["image_1","image"],["image_2","image"]] as const){
    const input={itemKey,kind,title:itemKey,brief:"Explain this project",visibility:"project" as const};
    const artifact=await f.store.createArtifact(ctx,input);pieces.set(itemKey,artifact);
    expect((await f.store.createArtifact(ctx,input)).id).toBe(artifact.id);
  }
  expect(new Set([...pieces.values()].map(a=>a.id)).size).toBe(5);
  let jobs=createArtifactJobs(f.database,f.store);
  const image=pieces.get("image_1")!,video=pieces.get("video")!;
  await f.store.writeArtifactFiles(ctx,image.id,0,{"fixture.txt":"image_1"});
  for(const [key,artifact] of pieces){
    if(artifact.id!==image.id)await f.store.writeArtifactFiles(ctx,artifact.id,0,{"fixture.txt":key},key==="video"?{dependencies:[{artifactId:image.id,revision:1}]}:{});
    await jobs.enqueueArtifactJob(ctx,artifact.id,1,"export",{});
  }
  const image2=pieces.get("image_2")!;
  const [image2Job]=await f.database.query(`select "id" from "artifactJobs" where "artifactId"=$1`,[image2.id]);
  await jobs.cancelArtifactJob(ctx,String(image2Job!.id));
  const bytes=new Map<string,Uint8Array>(),seen:string[]=[];
  const storage={put:async(key:string,value:Uint8Array)=>{bytes.set(key,value);},get:async(key:string)=>bytes.get(key)!,delete:async(key:string)=>{bytes.delete(key);}};
  // A real PNG fixture can be reused as bytes; no image provider is invoked.
  const png=Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=","base64"));
  let failVideo=true;
  const adapter:ArtifactAdapter=async input=>{
    seen.push(input.artifact.id);
    if(input.artifact.kind==="motion"){
      expect(input.assets.map(a=>a.id)).toEqual([`${image.id}@1/0`]);
      expect(input.assets[0]!.bytes).toEqual(png);
      if(failVideo)throw new ArtifactError("motion_video_invalid");
    }
    const isImage=input.artifact.kind==="image";
    return {outputs:[{name:isImage?"fixture.png":"fixture.txt",format:isImage?"png":"txt",mime:isImage?"image/png":"text/plain",bytes:isImage?png:new TextEncoder().encode(input.artifact.title)}],evidence:{valid:true,checks:["fixture bytes verified; infrastructure only"],checkedAt:new Date().toISOString()}};
  };
  const adapters=Object.fromEntries((["dashboard","slides","image","motion"] as ArtifactKind[]).map(kind=>[kind,adapter]));
  for(let n=0;n<5;n++){
    const claim=await jobs.claimArtifactJob(`process-${n}`);if(!claim)break;
    await runArtifactJob(claim,{database:f.database,store:f.store,jobs,storage,adapters},new AbortController().signal);
  }
  expect(seen.indexOf(image.id)).toBeLessThan(seen.indexOf(video.id));
  expect(seen).not.toContain(image2.id);
  for(const key of ["dashboard","slides","image_1"])expect((await f.store.getArtifact(ctx,pieces.get(key)!.id)).status).toBe("ready");
  expect((await f.store.getArtifact(ctx,video.id)).status).toBe("failed");
  expect((await f.store.getArtifact(ctx,image2.id)).status).toBe("cancelled");
  // New service objects simulate a disconnected client/reconnected process;
  // actual process death and Linux container recovery are separate exercises.
  const reconnected=createArtifactStore(f.database);jobs=createArtifactJobs(f.database,reconnected);
  const before=await reconnected.getRevision(ctx,image.id,1);
  const revision=await reconnected.writeArtifactFiles(ctx,video.id,1,{"fixture.txt":"corrected video"});
  await jobs.enqueueArtifactJob(ctx,video.id,revision.revision,"export",{});failVideo=false;
  const claim=(await jobs.claimArtifactJob("replacement"))!;
  expect((await runArtifactJob(claim,{database:f.database,store:reconnected,jobs,storage,adapters},new AbortController().signal)).status).toBe("completed");
  expect((await reconnected.getArtifact(ctx,video.id)).lastReadyRevision).toBe(2);
  expect((await reconnected.getRevision(ctx,image.id,1)).outputs).toEqual(before.outputs);
  const events=await createArtifactEvents(f.database).listArtifactEvents(ctx,"0");
  expect(events.filter(e=>e.type==="ready")).toHaveLength(4);
  expect(events.some(e=>e.artifactId===video.id&&e.type==="failed")).toBe(true);
  expect(events.some(e=>e.artifactId===image2.id&&e.type==="cancelled")).toBe(true);
},30_000);
