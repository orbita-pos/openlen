import { z } from "zod";
import { audioTrackSchema,type AudioTrack } from "./adapters/audio/manifest";
import { ArtifactError,type SealedArtifactInput } from "./types";
export const AUDIO_MIMES=["audio/wav","audio/mpeg","audio/mp4","audio/x-m4a","audio/ogg"] as const;
const track=audioTrackSchema.innerType().omit({asset:true}).extend({mime:z.enum(AUDIO_MIMES),dataBase64:z.string().min(4).max(28*1024*1024)}).strict().refine(t=>t.role!=="narration"||(t.trimSeconds===0&&t.durationSeconds===undefined&&t.fadeInSeconds===0&&t.fadeOutSeconds===0&&t.gain>0));
const mixSchema=z.object({durationSeconds:z.number().finite().min(1).max(120),duckMusic:z.boolean(),tracks:z.array(track).min(1).max(8)}).strict();
export type AudioMix=z.infer<typeof mixSchema>;
export function validateAudioMix(value:unknown):AudioMix{
  try{
    const mix=mixSchema.parse(value);let total=0;
    for(const t of mix.tracks){
      const bytes=Buffer.from(t.dataBase64,"base64");
      if(!bytes.length||bytes.length>20*1024*1024||(total+=bytes.length)>64*1024*1024||bytes.toString("base64")!==t.dataBase64||t.startSeconds>=mix.durationSeconds)throw Error("invalid");
    }
    return mix;
  }catch{throw new ArtifactError("invalid_audio_packet");}
}
export function prepareAudioTracks(input:SealedArtifactInput,tracks:readonly AudioTrack[]):AudioMix["tracks"]{
  return tracks.map(t=>{
    const asset=input.assets.find(a=>a.id===t.asset);
    if(!asset)throw new ArtifactError("audio_asset_missing",`track "${t.asset}" is not a ready audio output of this revision: name an audio item's exact output (inspect_artifact) after it is ready, or an upload: id from list_artifact_audio`);
    if(!AUDIO_MIMES.includes(asset.mime as typeof AUDIO_MIMES[number])||asset.bytes.length>20*1024*1024||!asset.bytes.length)throw new ArtifactError("audio_asset_invalid",`track "${t.asset}" is ${asset.mime}, ${asset.bytes.length} bytes: a track is an MP3, WAV, M4A or OGG of up to 20 MB`);
    const {asset:_,...settings}=t;void _;
    return {...settings,mime:asset.mime as typeof AUDIO_MIMES[number],dataBase64:Buffer.from(asset.bytes).toString("base64")};
  });
}
