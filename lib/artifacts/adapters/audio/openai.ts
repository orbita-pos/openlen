import type { ArtifactExternalOutcome } from "../../types";
import { speechSchema, type SpeechRequest } from "./manifest";
export interface SpeechReply extends ArtifactExternalOutcome {readonly pcm?:Uint8Array;readonly code?:string}
export type SpeechTransport=(request:SpeechRequest,signal:AbortSignal)=>Promise<SpeechReply>;
/** One POST, bounded raw PCM, no SDK retries and no provider URL fetching. */
export function openaiArtifactSpeechTransport(config:{apiKey:string;model:string;fetch?:typeof fetch}):SpeechTransport{
  return async(request,signal)=>{
    const base={model:config.model,requestId:null,usage:null,costMicroUsd:null};
    const spec=speechSchema.safeParse(request);
    if(!spec.success||!["gpt-4o-mini-tts","gpt-4o-mini-tts-2025-12-15"].includes(config.model))return {...base,outcome:"failed",code:"audio_request_invalid"};
    signal.throwIfAborted();
    let requestId:string|null=null;
    try{
      const response=await(config.fetch??fetch)("https://api.openai.com/v1/audio/speech",{method:"POST",redirect:"error",headers:{Authorization:`Bearer ${config.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:config.model,input:spec.data.text,voice:spec.data.voice,...spec.data.instructions?{instructions:spec.data.instructions}:{},response_format:"pcm"}),signal:AbortSignal.any([signal,AbortSignal.timeout(180_000)])});
      const id=response.headers.get("x-request-id");requestId=id&&/^[A-Za-z0-9_-]{1,200}$/.test(id)?id:null;
      if(!response.ok){await response.body?.cancel();return {...base,requestId,outcome:response.status>=500?"unknown":"failed",code:"audio_provider_error"};}
      if(!/^(audio\/(pcm|L16)|application\/octet-stream)(;|$)/i.test(response.headers.get("content-type")??"")||!response.body){await response.body?.cancel();return {...base,requestId,outcome:"failed",code:"audio_response_invalid"};}
      const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const {value,done}=await reader.read();if(done)break;if((size+=value.length)>5_760_000)throw new Error("response_too_large");chunks.push(value);}}finally{await reader.cancel().catch(()=>undefined);}
      if(size<2||size%2)return {...base,requestId,outcome:"failed",code:"audio_response_invalid"};
      return {...base,requestId,outcome:"succeeded",pcm:new Uint8Array(Buffer.concat(chunks))};
    }catch{return {...base,requestId,outcome:"unknown",code:"audio_outcome_unknown"};}
  };
}
