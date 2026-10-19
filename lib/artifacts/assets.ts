import { createHash } from "node:crypto";
import type { ArtifactStorage } from "./private-storage";
import type { ArtifactStore } from "./store";
import { ArtifactError, type ArtifactContext, type ArtifactRevision, type ResolvedAsset } from "./types";
import type {ArtifactDatabase} from "./types";
import type {AssetStorage} from "../projects/assets";
import {requireProjectAccess} from "./access";
import {AUDIO_MIMES} from "./audio-protocol";
export type ArtifactAudioUploads=Pick<AssetStorage,"listAudio"|"get">;
export function referencedAudioAssets(files:Readonly<Record<string,string>>={}):Set<string>{
  const ids=new Set<string>();
  for(const name of ["audio.json","motion.json"]){
    if(!Object.hasOwn(files,name))continue;
    try{const spec=JSON.parse(files[name]!);const tracks=name==="audio.json"?spec.tracks:spec.audio?.tracks;
      if(Array.isArray(tracks))for(const t of tracks)if(typeof t?.asset==="string")ids.add(t.asset);
    }catch{throw new ArtifactError("invalid_audio_manifest");}
  }
  if(ids.size>8)throw new ArtifactError("invalid_audio_manifest");return ids;
}

/** Only server-authorized, sealed dependency outputs. Never fetch model URLs. */
export async function resolveArtifactAssets(ctx: ArtifactContext, revision: Pick<ArtifactRevision,"dependencies"> & Partial<Pick<ArtifactRevision,"files">>, store: ArtifactStore, storage: ArtifactStorage, uploads?:ArtifactAudioUploads,database?:ArtifactDatabase): Promise<ResolvedAsset[]> {
  const assets: ResolvedAsset[] = [];
  const audioIds=referencedAudioAssets(revision.files);
  let total = 0;
  for (const dependency of revision.dependencies) {
    const pinned = await store.getRevision(ctx, dependency.artifactId, dependency.revision);
    if (!pinned.sealedAt || pinned.evidence?.valid !== true || !pinned.outputs.length) throw new ArtifactError("dependency_not_ready");
    for (const [index, output] of pinned.outputs.entries()) {
      const id=`${pinned.artifactId}@${pinned.revision}/${index}`;
      if (!["image/png", "image/jpeg", "image/webp"].includes(output.mime)&&!(audioIds.has(id)&&AUDIO_MIMES.includes(output.mime as typeof AUDIO_MIMES[number]))) continue;
      if (output.bytes > 20 * 1024 * 1024 || (total += output.bytes) > 64 * 1024 * 1024) throw new ArtifactError("assets_too_large");
      const bytes = await storage.get(output.key);
      if (bytes.length !== output.bytes || createHash("sha256").update(bytes).digest("hex") !== output.hash) throw new ArtifactError("asset_corrupt");
      assets.push({ id: `${pinned.artifactId}@${pinned.revision}/${index}`, mime: output.mime, bytes });
    }
  }
  const uploadIds=[...audioIds].filter(id=>id.startsWith("upload:"));
  if(uploadIds.length){
    if(!uploads||!database)throw new ArtifactError("audio_uploads_unavailable");
    await requireProjectAccess(database,ctx);
    const listed=await uploads.listAudio(ctx.projectId);
    for(const id of uploadIds){
      const filename=id.slice(7),item=listed.find(a=>a.filename===filename);
      if(!/^[a-f0-9]{64}\.(mp3|m4a|ogg|wav)$/.test(filename)||!item||!AUDIO_MIMES.includes(item.contentType as typeof AUDIO_MIMES[number])||item.size<=0||item.size>20*1024*1024||(total+=item.size)>64*1024*1024)throw new ArtifactError("audio_upload_invalid");
      const file=await uploads.get(ctx.projectId,filename,20*1024*1024);
      if(!file||file.contents.length!==item.size||file.contentType!==item.contentType||createHash("sha256").update(file.contents).digest("hex")!==filename.split(".")[0])throw new ArtifactError("asset_corrupt");
      assets.push({id,mime:file.contentType,bytes:new Uint8Array(file.contents)});
    }
  }
  return assets;
}
