import { ArtifactError, type AdapterResult, type SealedArtifactInput } from "../../types";
import type { ArtifactRender } from "../../render-protocol";
import { validateRenderPng } from "../dashboard/validate";
import { buildMotion } from "./runtime";
export async function renderMotion(input:SealedArtifactInput,render:ArtifactRender,signal:AbortSignal):Promise<AdapterResult>{
  const {html,manifest}=await buildMotion(input);signal.throwIfAborted();
  const result=await render({version:1,kind:"motion",html,width:manifest.width,height:manifest.height,fps:manifest.fps,durationSeconds:manifest.durationSeconds,frameCount:manifest.frameCount,probes:[]},signal);
  const checks=["runtime:no-errors","resources:complete","motion:seek-deterministic","video:h264","video:no-audio","video:decoded","video:frame-count-checked"];
  if(!result.mp4||result.mp4.length<32||Buffer.from(result.mp4).subarray(4,8).toString()!=="ftyp"||!checks.every(check=>result.checks.includes(check))||result.video?.frameCount!==manifest.frameCount||result.video.fps!==manifest.fps||!Number.isFinite(result.video.durationSeconds)||Math.abs(result.video.durationSeconds-manifest.durationSeconds)>1/manifest.fps)throw new ArtifactError("invalid_motion_render");
  validateRenderPng(result.png,manifest.width,manifest.height);
  return {outputs:[{name:"composition.html",format:"html",mime:"text/html",bytes:new TextEncoder().encode(html)},{name:"video.mp4",format:"mp4",mime:"video/mp4",bytes:result.mp4},{name:"poster.png",format:"png",mime:"image/png",bytes:result.png}],evidence:{valid:true,checkedAt:new Date().toISOString(),checks:["sources:compiled",`motion:runtime:${manifest.runtime}`,...result.checks]}};
}
