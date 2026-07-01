import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, weld, quantize, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { processImage } from "../images";

export interface OptimizeReport { beforeBytes: number; afterBytes: number; texturesConverted: number; }

const MAX_TEXTURE_DIM = 2048;
const WEBP_QUALITY = 82;

// PNG/JPEG textures → WebP (EXT_texture_webp — natively supported by three's
// GLTFLoader). Uses the repo's Rust processImage; no sharp dependency.
async function compressTextures(doc: Document): Promise<number> {
  let converted = 0;
  for (const tex of doc.getRoot().listTextures()) {
    const mime = tex.getMimeType();
    const image = tex.getImage();
    if (!image || (mime !== "image/png" && mime !== "image/jpeg")) continue;
    const { variants } = await processImage({
      input: Buffer.from(image),
      variants: [{ width: MAX_TEXTURE_DIM, maxHeight: MAX_TEXTURE_DIM, format: "webp", quality: WEBP_QUALITY }],
      autoOrient: false,
      withoutEnlargement: true,
    });
    const webp = variants[0].bytes;
    if (webp.byteLength >= image.byteLength) continue; // never make it bigger
    tex.setImage(new Uint8Array(webp)).setMimeType("image/webp");
    converted++;
  }
  return converted;
}

export async function optimizeGlb(input: Buffer): Promise<{ glb: Buffer; report: OptimizeReport }> {
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "meshopt.encoder": MeshoptEncoder,
    "meshopt.decoder": MeshoptDecoder,
  });
  const doc = await io.readBinary(new Uint8Array(input));
  await doc.transform(dedup(), weld(), quantize(), meshopt({ encoder: MeshoptEncoder }));
  const texturesConverted = await compressTextures(doc);
  const out = Buffer.from(await io.writeBinary(doc));
  return { glb: out, report: { beforeBytes: input.byteLength, afterBytes: out.byteLength, texturesConverted } };
}

export async function prepareModelGlb(input: Buffer, opts: { optimize: boolean }): Promise<{ glb: Buffer; report: OptimizeReport | null }> {
  if (!opts.optimize) return { glb: input, report: null };
  const { glb, report } = await optimizeGlb(input);
  return { glb, report };
}
