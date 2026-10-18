import { createRequire } from "node:module";
import { imageSize } from "image-size";
import { ArtifactError } from "../../types";
const requireNative=createRequire(import.meta.url);
/** Reuse OpenLen's Rust image decoder; a signature alone is not decode proof. */
export async function validateArtifactImage(bytes:Uint8Array,format:"png"|"jpeg"|"webp",width:number,height:number):Promise<{width:number;height:number}> {
  if(!bytes.length||bytes.length>20*1024*1024)throw new ArtifactError("invalid_image_bytes");
  const b=Buffer.from(bytes);
  const actual=b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?"png":b[0]===255&&b[1]===216&&b[2]===255?"jpeg":b.subarray(0,4).toString()==="RIFF"&&b.subarray(8,12).toString()==="WEBP"?"webp":null;
  if(actual!==format)throw new ArtifactError("image_mime_mismatch");
  let header:{width?:number;height?:number};
  try{header=imageSize(bytes);}catch{throw new ArtifactError("invalid_image_bytes");}
  // Reject decompression bombs before allocating a pixel buffer in the decoder.
  if(header.width!==width||header.height!==height)throw new ArtifactError("image_dimensions_mismatch");
  let dimensions:{width:number;height:number};
  try {
    const native=requireNative("@openlen/images") as typeof import("@openlen/images");
    const result=await native.processImage({input:b,variants:[{width:0,format:"png",quality:100}],autoOrient:true,withoutEnlargement:true});
    dimensions=result.variants[0]!;
  }catch{throw new ArtifactError("invalid_image_bytes");}
  if(!dimensions||dimensions.width!==width||dimensions.height!==height)throw new ArtifactError("image_dimensions_mismatch");
  return {width:dimensions.width,height:dimensions.height};
}
