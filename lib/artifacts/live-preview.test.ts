// @vitest-environment node
import {expect,it,vi} from "vitest";
import {connectArtifactLivePreview} from "./live-preview";
import {livePreviewScript} from "./live-preview-runtime";
import {runInNewContext} from "node:vm";
import {readFileSync} from "node:fs";
import {transformSync} from "esbuild";
const view={id:"a".repeat(24),artifactId:"artifact",revision:3,liveDatasetIds:["dataset"]};
const frame={} as Window;
function port(){return {postMessage:vi.fn(),close:vi.fn()};}
function request(reply=port(),extra:Record<string,unknown>={}){
  return {origin:"null",source:frame,ports:[reply],data:{kind:"openlen.artifact.live.request",channel:view.id,requestId:"request-1",datasetId:"dataset",...extra}} as unknown as MessageEvent;
}
const dataset={id:"dataset",mode:"live" as const,environment:"live" as const,visibility:"owner" as const,columns:["Total"],rows:[[12]],query:"select private",source:"backend",capturedAt:new Date().toISOString(),truncated:false};
it("binds an opaque document and one exact dataset, and never replies through a navigable WindowProxy",async()=>{
  const refresh=vi.fn(async(input:{revision:number;datasetId:string},_signal:AbortSignal)=>({dataset,revision:input.revision+1}));
  const bridge=connectArtifactLivePreview({frame,view,refresh});
  for(const event of [{...request(),source:{}},{...request(),origin:"https://evil.test"},request(port(),{channel:"wrong"}),{...request(),ports:[]}])await bridge.handle(event as MessageEvent);
  expect(refresh).not.toHaveBeenCalled();
  const rejected=port();await bridge.handle(request(rejected,{datasetId:"another"}));
  expect(rejected.postMessage).toHaveBeenCalledWith({ok:false,code:"live_dataset_not_found"});
  expect(refresh).not.toHaveBeenCalled();
  const reply=port();await bridge.handle(request(reply));
  expect(refresh).toHaveBeenCalledWith({revision:3,datasetId:"dataset"},expect.any(AbortSignal));
  const sent=reply.postMessage.mock.calls[0]![0];
  expect(sent).toMatchObject({ok:true,revision:4,dataset:{id:"dataset",rows:[[12]]}});
  expect(sent.dataset).not.toHaveProperty("query");
  expect(sent.dataset).not.toHaveProperty("parameters");
  const second=port();await bridge.handle(request(second,{requestId:"request-2"}));
  expect(refresh.mock.calls[1]![0]).toEqual({revision:4,datasetId:"dataset"});
  bridge.dispose();
});
it("allows only one refresh at a time and closes a pending reply on disposal",async()=>{
  let finish!:(value:{dataset:typeof dataset;revision:number})=>void;
  const refresh=vi.fn((_input:{revision:number;datasetId:string},_signal:AbortSignal)=>new Promise<{dataset:typeof dataset;revision:number}>(resolve=>{finish=resolve;}));
  const bridge=connectArtifactLivePreview({frame,view,refresh});
  const reply=port(),waiting=bridge.handle(request(reply)),busy=port();
  await bridge.handle(request(busy,{requestId:"request-2"}));
  expect(busy.postMessage).toHaveBeenCalledWith({ok:false,code:"data_refresh_busy"});
  const signal=refresh.mock.calls[0]![1] as AbortSignal;
  bridge.dispose();expect(signal.aborted).toBe(true);expect(reply.close).toHaveBeenCalled();
  finish({dataset,revision:4});await waiting;
  expect(reply.postMessage).not.toHaveBeenCalled();
});

it("runs the exact injected script in a fresh browser scope without compiler closure helpers",()=>{
  const cjsModule={exports:{} as {livePreviewScript:typeof livePreviewScript}};
  const transformed=transformSync(readFileSync(new URL("./live-preview-runtime.ts",import.meta.url),"utf8"),{loader:"ts",format:"cjs",target:"es2022",keepNames:true});
  runInNewContext(transformed.code,{module:cjsModule});
  for(const script of [livePreviewScript,cjsModule.exports.livePreviewScript]){
    const browser:Record<string,unknown>={};
    runInNewContext(script({appOrigin:"https://app.test",channel:view.id,datasetIds:["dataset"]}),{window:browser,Set,Object});
    expect(typeof (browser.lenLive as {refresh:unknown}).refresh).toBe("function");
  }
});
