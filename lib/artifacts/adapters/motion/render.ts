import { ArtifactError, type AdapterResult, type SealedArtifactInput } from "../../types";
import type { ArtifactRender } from "../../render-protocol";
import { validateRenderPng } from "../dashboard/validate";
import { buildMotion } from "./runtime";
import {buildProjectCaptures} from "./captures";
import {validateArtifactImage} from "../image/validate";
export async function renderMotion(input:SealedArtifactInput,render:ArtifactRender,signal:AbortSignal):Promise<AdapterResult>{
  const captures=await buildProjectCaptures(input),assets=[...input.assets],captureOutputs:AdapterResult["outputs"][number][]=[],captureChecks:string[]=[];
  let capturedBytes=0;
  for(const capture of captures){
    signal.throwIfAborted();
    const image=await render({version:1,kind:"capture",html:capture.html,width:capture.width,height:capture.height,probes:[]},signal);
    if(!image.checks.includes("runtime:no-errors")||!image.checks.includes("resources:complete")||!image.checks.includes("source-capture:offline"))throw new ArtifactError("invalid_capture_render");
    if((capturedBytes+=image.png.length)>4*1024*1024)throw new ArtifactError("capture_assets_too_large");
    await validateArtifactImage(image.png,"png",capture.width,capture.height);
    assets.push({id:`capture:${capture.id}`,mime:"image/png",bytes:image.png});
    captureOutputs.push({name:`capture-${capture.id}.png`,format:"png",mime:"image/png",bytes:image.png});
    captureChecks.push(`source-capture:${capture.id}:hash-verified-offline`);
  }
  const {html,manifest}=await buildMotion({...input,assets});signal.throwIfAborted();
  const result=await render({version:1,kind:"motion",html,width:manifest.width,height:manifest.height,fps:manifest.fps,durationSeconds:manifest.durationSeconds,frameCount:manifest.frameCount,probes:[]},signal);
  const checks=["runtime:no-errors","resources:complete","motion:seek-deterministic","video:h264","video:no-audio","video:decoded","video:frame-count-checked"];
  if(!result.mp4||result.mp4.length<32||Buffer.from(result.mp4).subarray(4,8).toString()!=="ftyp"||!checks.every(check=>result.checks.includes(check))||result.video?.frameCount!==manifest.frameCount||result.video.fps!==manifest.fps||!Number.isFinite(result.video.durationSeconds)||Math.abs(result.video.durationSeconds-manifest.durationSeconds)>1/manifest.fps)throw new ArtifactError("invalid_motion_render");
  validateRenderPng(result.png,manifest.width,manifest.height);
  return {outputs:[{name:"composition.html",format:"html",mime:"text/html",bytes:new TextEncoder().encode(html)},{name:"video.mp4",format:"mp4",mime:"video/mp4",bytes:result.mp4},{name:"poster.png",format:"png",mime:"image/png",bytes:result.png},...captureOutputs],evidence:{valid:true,checkedAt:new Date().toISOString(),checks:["sources:compiled",`motion:runtime:${manifest.runtime}`,...captureChecks,...result.checks]}};
}
