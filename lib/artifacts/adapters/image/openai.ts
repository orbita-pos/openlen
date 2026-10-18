import type { ArtifactExternalOutcome, ResolvedAsset } from "../../types";
import { imageGenerationCostMicroUsd } from "../../../ai/cost-rates";
export interface ImageTransportRequest {readonly prompt:string;readonly width:number;readonly height:number;readonly format:"png"|"jpeg"|"webp";readonly quality:"medium";readonly references:readonly ResolvedAsset[]}
export interface ImageTransportReply extends ArtifactExternalOutcome {readonly bytes?:Uint8Array;readonly code?:string}
export type ImageTransport=(request:ImageTransportRequest,signal:AbortSignal)=>Promise<ImageTransportReply>;
function imageUsage(value:unknown):Record<string,unknown>|null {
  if (!value||typeof value!=="object"||Array.isArray(value)) return null;
  const result:Record<string,unknown>={};
  for (const key of ["input_tokens","output_tokens","total_tokens","input_tokens_details","output_tokens_details"]) {
    const v=(value as Record<string,unknown>)[key];
    if (typeof v==="number"&&Number.isSafeInteger(v)&&v>=0) result[key]=v;
    else if (key.endsWith("_details")&&v&&typeof v==="object") {
      const counters=Object.fromEntries(Object.entries(v).filter(([k,n])=>["text_tokens","image_tokens","cached_tokens"].includes(k)&&typeof n==="number"&&Number.isSafeInteger(n)&&n>=0));
      if (Object.keys(counters).length) result[key]=counters;
    }
  }
  return Object.keys(result).length?result:null;
}
async function boundedJson(response:Response):Promise<Record<string,unknown>> {
  if (!response.body) throw new Error("empty_response");
  const reader=response.body.getReader(); const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>30*1024*1024)throw new Error("response_too_large");chunks.push(value);}}finally{await reader.cancel().catch(()=>undefined);}
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string,unknown>;
}
/** Direct Images API. One POST, no SDK retries or provider-returned URL fetch. */
export function openaiArtifactImageTransport(config:{readonly apiKey:string;readonly model:string;readonly fetch?:typeof fetch}):ImageTransport {
  return async(request,signal)=>{
    const base={model:config.model,requestId:null,usage:null,costMicroUsd:null};
    const common={model:config.model,prompt:request.prompt,n:1,size:`${request.width}x${request.height}`,quality:request.quality,output_format:request.format,...(request.format!=="png"?{output_compression:82}:{})};
    let body:string|FormData;let endpoint="generations";
    const headers:Record<string,string>={Authorization:`Bearer ${config.apiKey}`};
    if(request.references.length){endpoint="edits";const form=new FormData();for(const [k,v]of Object.entries(common))form.append(k,String(v));for(const asset of request.references)form.append("image[]",new Blob([Uint8Array.from(asset.bytes)],{type:asset.mime}),`reference.${asset.mime.split("/")[1]}`);body=form;}
    else {headers["Content-Type"]="application/json";body=JSON.stringify(common);}
    try {
      const response=await(config.fetch??fetch)(`https://api.openai.com/v1/images/${endpoint}`,{method:"POST",headers,body,signal:AbortSignal.any([signal,AbortSignal.timeout(180_000)])});
      const id=response.headers.get("x-request-id");
      const data=await boundedJson(response);const usage=imageUsage(data.usage);
      const receipt={...base,requestId:id&&/^[A-Za-z0-9_-]{1,200}$/.test(id)?id:null,costMicroUsd:imageGenerationCostMicroUsd(config.model,usage)};
      if(!response.ok){const error=data.error as {code?:unknown}|undefined;const rejected=typeof error?.code==="string"&&/content_policy|moderation|safety/.test(error.code);return {...receipt,usage,outcome:rejected?"rejected":response.status>=500?"unknown":"failed",code:rejected?"image_content_rejected":"image_provider_error"};}
      const images=data.data;
      if(!Array.isArray(images)||images.length!==1||typeof images[0]?.b64_json!=="string"||!images[0].b64_json.length||images[0].b64_json.length>28*1024*1024||images[0].b64_json.length%4!==0)return {...receipt,usage,outcome:"failed",code:"image_response_incomplete"};
      const bytes=new Uint8Array(Buffer.from(images[0].b64_json,"base64"));
      if(Buffer.from(bytes).toString("base64")!==images[0].b64_json)return {...receipt,usage,outcome:"failed",code:"image_response_incomplete"};
      return {...receipt,usage,outcome:"succeeded",bytes};
    }catch{return {...base,outcome:"unknown",code:"image_outcome_unknown"};}
  };
}
