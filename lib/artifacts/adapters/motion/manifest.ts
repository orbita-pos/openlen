import { z } from "zod";
import { safeArtifactPath } from "../../state";
import { ArtifactError, type SealedArtifactInput } from "../../types";
const schema=z.object({version:z.literal(1),entry:z.string(),runtime:z.literal("gsap-3.15.0"),width:z.literal(1280),height:z.literal(720),fps:z.literal(30),durationSeconds:z.number().finite().min(1).max(120),datasetIds:z.array(z.string().min(1)).max(20).default([])}).strict();
export function motionManifest(input:SealedArtifactInput){
  try{
    const value=schema.parse(JSON.parse(input.revision.files["motion.json"]??""));
    if(!safeArtifactPath(value.entry)||!value.entry.endsWith(".html")||!Object.hasOwn(input.revision.files,value.entry)
      ||Math.abs(value.durationSeconds*value.fps-Math.round(value.durationSeconds*value.fps))>1e-6
      ||new Set(value.datasetIds).size!==value.datasetIds.length||value.datasetIds.some(id=>!input.datasets.some(d=>d.id===id)))throw new Error("invalid");
    return {...value,frameCount:Math.round(value.durationSeconds*value.fps)};
  }catch{throw new ArtifactError("invalid_motion_manifest");}
}
