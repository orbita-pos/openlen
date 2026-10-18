import { ArtifactError, type AdapterResult, type ArtifactAdapterHooks, type SealedArtifactInput } from "../../types";
import { imageManifest } from "./manifest";
import { validateArtifactImage } from "./validate";
import type { ImageTransport } from "./openai";
export async function generateArtifactImage(input:SealedArtifactInput,deps:{transport:ImageTransport;model:string},signal:AbortSignal,hooks:ArtifactAdapterHooks):Promise<AdapterResult> {
  const spec=imageManifest(input);
  signal.throwIfAborted();
  const references=spec.references.map(id=>input.assets.find(a=>a.id===id)!);
  for(const asset of references)if(!["image/png","image/jpeg","image/webp"].includes(asset.mime)||asset.bytes.length>20*1024*1024)throw new ArtifactError("image_reference_invalid");
  await hooks.beforeExternalCall(deps.model);signal.throwIfAborted();
  const reply=await deps.transport({...spec,references},signal);
  await hooks.recordExternalOutcome({outcome:reply.outcome,model:reply.model,requestId:reply.requestId,usage:reply.usage,costMicroUsd:reply.costMicroUsd});
  if(reply.outcome!=="succeeded"||!reply.bytes)throw new ArtifactError(reply.code??"image_response_incomplete");
  signal.throwIfAborted();
  await validateArtifactImage(reply.bytes,spec.format,spec.width,spec.height);
  return {outputs:[{name:`image.${spec.format}`,format:spec.format,mime:`image/${spec.format}`,bytes:reply.bytes}],evidence:{valid:true,checkedAt:new Date().toISOString(),checks:["image:decoded",`image:dimensions:${spec.width}x${spec.height}`,`image:mime:${spec.format}`,"references:pinned","provider:complete-image"]}};
}
