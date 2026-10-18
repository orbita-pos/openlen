// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import { motionManifest } from "./manifest";
import { buildMotion } from "./runtime";
import { renderMotion } from "./render";
import { stopBundlerWorker } from "../../../apps/bundler/bundle-app";
import type { SealedArtifactInput } from "../../types";
const spec={version:1,entry:"index.html",runtime:"gsap-3.15.0",width:1280,height:720,fps:30,durationSeconds:6,datasetIds:[]};
const input={artifact:{kind:"motion"},revision:{files:{"motion.json":JSON.stringify(spec),"index.html":'<!doctype html><html><head><title>Demo</title></head><body><h1>Mi aplicación</h1><script src="main.ts"></script></body></html>',"main.ts":'const tl=gsap.timeline({paused:true});tl.fromTo("h1",{x:0},{x:100,duration:6,immediateRender:false});window.lenMotion={durationSeconds:6,ready:async()=>{},seek:async(t:number)=>{tl.totalTime(t,true);}};'}},assets:[],datasets:[]} as unknown as SealedArtifactInput;
afterAll(()=>stopBundlerWorker());
it("bounds video duration and fps, including the exact last sampled frame",()=>{
  expect(motionManifest(input)).toMatchObject({frameCount:180});
  const bad=(patch:object)=>({...input,revision:{...input.revision,files:{...input.revision.files,"motion.json":JSON.stringify({...spec,...patch})}}});
  expect(()=>motionManifest(bad({durationSeconds:121}))).toThrow();expect(()=>motionManifest(bad({fps:60}))).toThrow();expect(()=>motionManifest(bad({durationSeconds:1.01}))).toThrow();
});
it("uses the existing app compiler, freezes runtime/resources and never evaluates authored code in Node",async()=>{
  const built=await buildMotion(input);
  expect(built.html).toContain("GSAP 3.15.0");expect(built.html).toContain("Mi aplicación");expect(built.html).not.toContain('src="main.ts"');
  expect(built.html).toContain("connect-src 'none'");expect(built.html).not.toContain("len-data-provenance");
  const broken={...input,revision:{...input.revision,files:{...input.revision.files,"main.ts":"const broken = ;"}}};
  await expect(buildMotion(broken)).rejects.toMatchObject({code:"artifact_compile_failed"});
});
it("does not report ready from an MP4 signature without real frame/codec/decode evidence",async()=>{
  await expect(renderMotion(input,async()=>({png:new Uint8Array(),mp4:new Uint8Array([0,0,0,20,102,116,121,112]),checks:["claimed complete"]}),new AbortController().signal)).rejects.toMatchObject({code:"invalid_motion_render"});
});
