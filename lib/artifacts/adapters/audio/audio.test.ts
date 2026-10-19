// @vitest-environment node
import { expect, it } from "vitest";
import { audioManifest } from "./manifest";
import { pcmToWav } from "./pcm";
import { openaiArtifactSpeechTransport } from "./openai";
import type { SealedArtifactInput } from "../../types";
const input=(spec:unknown)=>({artifact:{kind:"audio"},revision:{files:{"audio.json":JSON.stringify(spec)}},assets:[],datasets:[]} as unknown as SealedArtifactInput);
const spec={version:1,speech:{text:"Conoce mi aplicación",voice:"coral"}};
it("validates narration and bounded numeric track settings without accepting generated music or URLs",()=>{
  expect(audioManifest(input(spec))).toMatchObject({speech:{text:"Conoce mi aplicación",voice:"coral"},tracks:[]});
  for(const value of [{version:1},{...spec,speech:{text:"a".repeat(4097)}},{...spec,speech:{text:"Hi",voice:"fake"}},{...spec,durationSeconds:121},{version:1,durationSeconds:4,tracks:[{asset:"https://evil/audio.mp3"}]},{version:1,durationSeconds:4,tracks:[{asset:"pinned@1/0",gain:-1}]},{...spec,musicPrompt:"generate a song"}])expect(()=>audioManifest(input(value))).toThrow();
});
it("wraps the exact complete 24kHz PCM samples and derives duration without guessing from script length",()=>{
  const pcm=new Uint8Array(48_000);new DataView(pcm.buffer).setInt16(0,1234,true);
  const {wav,durationSeconds}=pcmToWav(pcm);
  expect(durationSeconds).toBe(1);expect(Buffer.from(wav).subarray(0,4).toString()).toBe("RIFF");expect(Buffer.from(wav).readUInt32LE(24)).toBe(24000);expect(Buffer.from(wav).subarray(44)).toEqual(Buffer.from(pcm));
  for(const bad of [new Uint8Array(),new Uint8Array(3),new Uint8Array(5_760_002)])expect(()=>pcmToWav(bad)).toThrow();
});
it("sends exactly one bounded speech request with delivery instructions and keeps unknown cost null",async()=>{
  const calls:{url:string;body:unknown}[]=[];
  const transport=openaiArtifactSpeechTransport({apiKey:"test",model:"gpt-4o-mini-tts-2025-12-15",fetch:async(url,options)=>{calls.push({url:String(url),body:JSON.parse(String(options?.body))});return new Response(new Uint8Array(48_000),{headers:{"content-type":"audio/pcm","x-request-id":"req_voice"}});}});
  const result=await transport({text:"Hola",voice:"coral",instructions:"Español mexicano, tono cálido"},new AbortController().signal);
  expect(calls).toEqual([{url:"https://api.openai.com/v1/audio/speech",body:{model:"gpt-4o-mini-tts-2025-12-15",input:"Hola",voice:"coral",instructions:"Español mexicano, tono cálido",response_format:"pcm"}}]);
  expect(result).toMatchObject({outcome:"succeeded",requestId:"req_voice",costMicroUsd:null,usage:null});expect(result.pcm).toHaveLength(48000);
});
it("never retries an ambiguous speech call and rejects non-audio, oversized or incomplete PCM responses",async()=>{
  let calls=0;
  const timeout=openaiArtifactSpeechTransport({apiKey:"test",model:"gpt-4o-mini-tts-2025-12-15",fetch:async()=>{calls++;throw new Error("timeout");}});
  expect((await timeout({text:"Hola",voice:"coral"},new AbortController().signal)).outcome).toBe("unknown");expect(calls).toBe(1);
  for(const response of [new Response("{}",{headers:{"content-type":"application/json"}}),new Response(new Uint8Array(3),{headers:{"content-type":"audio/pcm"}}),new Response(new Uint8Array(5_760_002),{headers:{"content-type":"audio/pcm"}})]){
    const transport=openaiArtifactSpeechTransport({apiKey:"test",model:"gpt-4o-mini-tts-2025-12-15",fetch:async()=>response});expect((await transport({text:"Hola",voice:"coral"},new AbortController().signal)).outcome).not.toBe("succeeded");
  }
  const rejected=openaiArtifactSpeechTransport({apiKey:"test",model:"gpt-4o-mini-tts-2025-12-15",fetch:async()=>new Response("private provider body",{status:400})});
  expect(await rejected({text:"Hola",voice:"coral"},new AbortController().signal)).toMatchObject({outcome:"failed",code:"audio_provider_error"});
});
