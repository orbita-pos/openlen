// @vitest-environment node
import {createHash} from "node:crypto";
import {afterAll,expect,it} from "vitest";
import {buildProjectCaptures} from "./captures";
import {stopBundlerWorker} from "../../../apps/bundler/bundle-app";
import type {SealedArtifactInput} from "../../types";
import {renderMotion} from "./render";
import {solidPng} from "../../testing/png";
import {validateRenderPacket,type ArtifactRender} from "../../render-protocol";
const html='<html><head><title>Original app</title></head><body><h1>Original app</h1><script src="./main.ts"></script></body></html>';
const source='document.querySelector("h1").textContent="Frozen project screen";';
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
const input={artifact:{kind:"motion"},revision:{sourceRef:{frozenSourcePrefix:"project-source/",files:{"/index.html":hash(html),"/main.ts":hash(source)}},files:{"motion.json":JSON.stringify({version:1,entry:"index.html",runtime:"gsap-3.15.0",width:1280,height:720,fps:30,durationSeconds:1,captures:[{id:"home",entry:"/index.html"}]}),"index.html":"<html><head></head><body>Video</body></html>","project-source/index.html":html,"project-source/main.ts":source}},datasets:[],assets:[]} as unknown as SealedArtifactInput;
afterAll(()=>stopBundlerWorker());
it("compiles only hash-verified frozen source for offline capture, without runtime data or composition code",async()=>{
  const packets=await buildProjectCaptures(input);
  expect(packets).toHaveLength(1);expect(packets[0]).toMatchObject({id:"home",width:1280,height:720});
  expect(packets[0]!.html).toContain("Frozen project screen");
  expect(packets[0]!.html).toContain("connect-src 'none'");
  expect(packets[0]!.html).not.toContain(">Video<");
  expect(packets[0]!.html).not.toContain("len-data-provenance");
});
it("rejects edited/missing frozen files, missing capture provenance and external resources",async()=>{
  const patch=(files:Record<string,string>)=>({...input,revision:{...input.revision,files:{...input.revision.files,...files}}});
  await expect(buildProjectCaptures(patch({"project-source/main.ts":"changed by model"}))).rejects.toMatchObject({code:"frozen_source_changed",message:expect.stringMatching(/project-source\/main\.ts changed after it was frozen.*never edit project-source\/ or the app.*refresh_source_paths/)});
  await expect(buildProjectCaptures({...input,revision:{...input.revision,sourceRef:null}})).rejects.toMatchObject({code:"frozen_source_missing"});
  const external=html.replace('<script src="./main.ts"></script>','<img src="https://customer.example/private.png">');
  const remote={...patch({"project-source/index.html":external}),revision:{...input.revision,files:{...input.revision.files,"project-source/index.html":external},sourceRef:{...input.revision.sourceRef!,files:{...input.revision.sourceRef!.files,"/index.html":hash(external)}}}};
  await expect(buildProjectCaptures(remote)).rejects.toMatchObject({code:"artifact_resource_missing"});
});

it("renders a frozen screen before encoding, embeds its exact bytes, and saves a reusable capture output",async()=>{
  const png=solidPng(1280,720),mp4=new Uint8Array(64);mp4.set(Buffer.from("ftyp"),4);
  const withImage={...input,revision:{...input.revision,files:{...input.revision.files,"index.html":'<html><head></head><body>Video<img src="asset:capture:home"></body></html>'}}};
  const calls:string[]=[];
  const render:ArtifactRender=async packet=>{
    calls.push(packet.kind);
    if(packet.kind==="capture")return {png,checks:["runtime:no-errors","resources:complete","source-capture:offline"]};
    expect(packet.html).toContain(`data:image/png;base64,${Buffer.from(png).toString("base64")}`);
    return {png,mp4,checks:["runtime:no-errors","resources:complete","motion:seek-deterministic","video:h264","video:no-audio","video:decoded","video:frame-count-checked"],video:{frameCount:30,fps:30,durationSeconds:1}};
  };
  const result=await renderMotion(withImage,render,new AbortController().signal);
  expect(calls).toEqual(["capture","motion"]);
  expect(result.outputs.map(o=>o.name)).toEqual(["composition.html","video.mp4","poster.png","capture-home.png"]);
  expect(result.outputs[3]!.bytes).toEqual(png);
  expect(result.evidence.checks).toContain("source-capture:home:hash-verified-offline");
  await expect(renderMotion(withImage,async()=>({png,checks:[]}),new AbortController().signal)).rejects.toMatchObject({code:"invalid_capture_render"});
  await expect(renderMotion(withImage,async()=>({png,checks:["runtime:no-errors","resources:complete"]}),new AbortController().signal)).rejects.toMatchObject({code:"invalid_capture_render"});
},30_000);

it("uses a dedicated offline capture packet, with no dataset/probe requirement",()=>{
  expect(()=>validateRenderPacket({version:1,kind:"capture",html,width:1280,height:720,probes:[]})).not.toThrow();
});

it("sends a hash route with the capture, and only a route",async()=>{
  const routed={...input,revision:{...input.revision,files:{...input.revision.files,"motion.json":input.revision.files["motion.json"]!.replace('"entry":"/index.html"}','"entry":"/index.html#/reservar"}')}}};
  expect((await buildProjectCaptures(routed))[0]).toMatchObject({id:"home",route:"#/reservar"});
  expect(()=>validateRenderPacket({version:1,kind:"capture",html,width:1280,height:720,probes:[],route:"#/reservar"} as never)).not.toThrow();
  expect(()=>validateRenderPacket({version:1,kind:"capture",html,width:1280,height:720,probes:[],route:"javascript:alert(1)"} as never)).toThrow();
});
