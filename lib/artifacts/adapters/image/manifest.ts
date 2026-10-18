import { z } from "zod";
import { ArtifactError, type SealedArtifactInput } from "../../types";
const schema = z.object({version:z.literal(1),prompt:z.string().trim().min(1).max(20_000),width:z.number().int(),height:z.number().int(),format:z.enum(["png","jpeg","webp"]),quality:z.literal("medium"),references:z.array(z.string().min(1).max(200)).max(8).default([])}).strict();
export type ImageManifest = z.infer<typeof schema>;
export function imageManifest(input: SealedArtifactInput): ImageManifest {
  let value:ImageManifest;
  try {value=schema.parse(JSON.parse(input.revision.files["image.json"]??""));}catch{throw new ArtifactError("invalid_image_manifest");}
  if (!["1024x1024","1536x1024","1024x1536"].includes(`${value.width}x${value.height}`)) throw new ArtifactError("image_size_unsupported");
  if (new Set(value.references).size!==value.references.length || value.references.some(id=>!input.assets.some(a=>a.id===id))) throw new ArtifactError("image_reference_missing");
  const formats=input.jobOptions?.formats;
  if (formats!==undefined && (!Array.isArray(formats)||formats.length!==1||formats[0]!==value.format)) throw new ArtifactError("image_format_mismatch");
  return value;
}
