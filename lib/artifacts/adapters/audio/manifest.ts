import { z } from "zod";
import { ArtifactError, type SealedArtifactInput } from "../../types";
export const audioTrackSchema=z.object({
  asset:z.string().regex(/^(?:[A-Za-z0-9_-]+@[1-9]\d*\/\d+|upload:[a-f0-9]{64}\.(?:mp3|m4a|ogg|wav))$/),
  role:z.enum(["narration","music","effect"]).default("effect"),
  startSeconds:z.number().finite().min(0).max(120).default(0),
  trimSeconds:z.number().finite().min(0).max(120).default(0),
  durationSeconds:z.number().finite().positive().max(120).optional(),
  gain:z.number().finite().min(0).max(2).default(1),
  fadeInSeconds:z.number().finite().min(0).max(10).default(0),
  fadeOutSeconds:z.number().finite().min(0).max(10).default(0),
}).strict().refine(t=>t.role!=="narration"||(t.trimSeconds===0&&t.durationSeconds===undefined&&t.fadeInSeconds===0&&t.fadeOutSeconds===0&&t.gain>0));
export type AudioTrack=z.infer<typeof audioTrackSchema>;
export const speechSchema=z.object({text:z.string().trim().min(1).max(4096),voice:z.enum(["alloy","ash","ballad","coral","echo","fable","onyx","nova","sage","shimmer","verse","marin","cedar"]).default("coral"),instructions:z.string().trim().max(2000).optional()}).strict();
export type SpeechRequest=z.infer<typeof speechSchema>;
const schema=z.object({version:z.literal(1),speech:speechSchema.optional(),durationSeconds:z.number().finite().min(1).max(120).optional(),tracks:z.array(audioTrackSchema).max(8).default([])}).strict().refine(s=>(s.speech||s.tracks.length>0)&&(s.speech||s.durationSeconds!==undefined)&&s.tracks.length+(s.speech?1:0)<=8);
export function audioManifest(input:SealedArtifactInput){
  try{return schema.parse(JSON.parse(input.revision.files["audio.json"]??""));}catch{throw new ArtifactError("invalid_audio_manifest");}
}
