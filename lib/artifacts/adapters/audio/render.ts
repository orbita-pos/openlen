import { ArtifactError,type AdapterResult,type ArtifactAdapterHooks,type SealedArtifactInput } from "../../types";
import type { ArtifactRender } from "../../render-protocol";
import {prepareAudioTracks,validateAudioMix} from "../../audio-protocol";
import { audioManifest } from "./manifest";
import {pcmToWav} from "./pcm";
import type {SpeechTransport} from "./openai";
export async function renderAudio(input:SealedArtifactInput,deps:{transport:SpeechTransport;model:string},render:ArtifactRender,signal:AbortSignal,hooks:ArtifactAdapterHooks):Promise<AdapterResult>{
  const spec=audioManifest(input),tracks=prepareAudioTracks(input,spec.tracks);
  const formats=input.jobOptions?.formats;
  if(formats!==undefined&&(!Array.isArray(formats)||!formats.length||formats.some(f=>!["mp3","wav"].includes(String(f)))))throw new ArtifactError("audio_format_mismatch");
  // Reject bad referenced inputs and envelope limits before spending anything.
  if(tracks.length)validateAudioMix({durationSeconds:spec.durationSeconds??120,duckMusic:true,tracks});
  let narration:ReturnType<typeof pcmToWav>|undefined;
  if(spec.speech){
    signal.throwIfAborted();await hooks.beforeExternalCall(deps.model);signal.throwIfAborted();
    const reply=await deps.transport(spec.speech,signal);
    await hooks.recordExternalOutcome({outcome:reply.outcome,model:reply.model,requestId:reply.requestId,usage:reply.usage,costMicroUsd:reply.costMicroUsd});
    if(reply.outcome!=="succeeded"||!reply.pcm)throw new ArtifactError(reply.code??"audio_response_invalid");
    signal.throwIfAborted();narration=pcmToWav(reply.pcm);
  }
  const durationSeconds=spec.durationSeconds??Math.max(1,Math.ceil(narration!.durationSeconds*30)/30);
  if(narration&&narration.durationSeconds>durationSeconds+1/48000)throw new ArtifactError("audio_narration_overflow");
  if(narration)tracks.unshift({mime:"audio/wav",dataBase64:Buffer.from(narration.wav).toString("base64"),role:"narration",startSeconds:0,trimSeconds:0,gain:1,fadeInSeconds:0,fadeOutSeconds:0});
  const audio=validateAudioMix({durationSeconds,duckMusic:true,tracks});
  const result=await render({version:1,kind:"audio",html:"",width:1280,height:720,probes:[],audio},signal);
  const checks=["audio:decoded","audio:duration-checked","audio:stereo-48000","audio:mp3-wav"];
  if(!result.mp3?.length||!result.wav?.length||!checks.every(c=>result.checks.includes(c))||!result.audio||!Number.isFinite(result.audio.durationSeconds)||Math.abs(result.audio.durationSeconds-durationSeconds)>1/48000||result.audio.sampleRate!==48000||result.audio.channels!==2)throw new ArtifactError("invalid_audio_render");
  const metadata={version:1,durationSeconds,sampleRate:48000,channels:2,generatedVoice:!!narration,...narration?{voiceDisclosure:"Voz generada por IA",voice:spec.speech!.voice,model:deps.model}:{}};
  return {outputs:[{name:"audio.mp3",format:"mp3",mime:"audio/mpeg",bytes:result.mp3},{name:"audio.wav",format:"wav",mime:"audio/wav",bytes:result.wav},...narration?[{name:"narration.wav",format:"wav",mime:"audio/wav",bytes:narration.wav}]:[],{name:"audio-metadata.json",format:"json",mime:"application/json",bytes:new TextEncoder().encode(JSON.stringify(metadata))}],evidence:{valid:true,checkedAt:new Date().toISOString(),checks:[...checks,`audio:durationSeconds:${durationSeconds}`,...narration?["voice:ai-generated","provider:complete-pcm"]:[]]}};
}
