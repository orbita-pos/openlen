// @vitest-environment node
import { expect,it } from "vitest";
import { renderAudio } from "./render";
import type { ArtifactAdapterHooks,SealedArtifactInput } from "../../types";
const input=(patch:object={})=>({artifact:{kind:"audio"},revision:{files:{"audio.json":JSON.stringify({version:1,speech:{text:"Hola",voice:"coral"},...patch})}},assets:[],datasets:[]} as unknown as SealedArtifactInput);
it("records speech before mixing and never calls OpenAI for missing or invalid referenced audio",async()=>{
  const events:string[]=[];
  const hooks:ArtifactAdapterHooks={beforeExternalCall:async()=>{events.push("admitted");},recordExternalOutcome:async r=>{events.push(r.outcome);}};
  const deps={model:"gpt-4o-mini-tts-2025-12-15",transport:async()=>{events.push("post");return {outcome:"succeeded" as const,model:"gpt-4o-mini-tts-2025-12-15",requestId:"req_voice",usage:null,costMicroUsd:null,pcm:new Uint8Array(48000)};}};
  const result=await renderAudio(input(),deps,async p=>{
    expect(events).toEqual(["admitted","post","succeeded"]);expect(p.kind).toBe("audio");
    return {png:new Uint8Array(),wav:new Uint8Array(100),mp3:new Uint8Array(100),audio:{durationSeconds:1,sampleRate:48000,channels:2},checks:["audio:decoded","audio:duration-checked","audio:stereo-48000","audio:mp3-wav"]};
  },new AbortController().signal,hooks);
  expect(result.outputs.map(x=>x.name)).toEqual(["audio.mp3","audio.wav","narration.wav","audio-metadata.json"]);
  events.length=0;
  await expect(renderAudio(input({tracks:[{asset:"missing@1/0"}]}),deps,async()=>{throw Error("not reached");},new AbortController().signal,hooks)).rejects.toMatchObject({code:"audio_asset_missing"});expect(events).toEqual([]);
});
it("fails narration that exceeds an explicit duration and never claims readiness from an unchecked render",async()=>{
  const hooks:ArtifactAdapterHooks={beforeExternalCall:async()=>{},recordExternalOutcome:async()=>{}};
  const deps={model:"gpt-4o-mini-tts-2025-12-15",transport:async()=>({outcome:"succeeded" as const,model:"gpt-4o-mini-tts-2025-12-15",requestId:null,usage:null,costMicroUsd:null,pcm:new Uint8Array(96000)})};
  await expect(renderAudio(input({durationSeconds:1}),deps,async()=>{throw Error("not reached");},new AbortController().signal,hooks)).rejects.toMatchObject({code:"audio_narration_overflow"});
  await expect(renderAudio(input(),deps,async()=>({png:new Uint8Array(),checks:[]}),new AbortController().signal,hooks)).rejects.toMatchObject({code:"invalid_audio_render"});
});
