import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import type { SealedArtifactInput } from "../../types";
import { compileArtifactHtml } from "../dashboard/compile";
import { motionManifest } from "./manifest";
let runtime:Promise<string>|undefined;
/** `checkOnly`: compile without GSAP — what render_artifact checks before queuing. The Next server bundles this
 *  file, and resolving gsap from a bundle fails (trial E); only the worker reads it, lazily. */
export async function buildMotion(input:SealedArtifactInput,options:{checkOnly?:boolean}={}){
  const manifest=motionManifest(input);
  const gsap=options.checkOnly?"":await(runtime??=readFile(createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"),"utf8").catch(error=>{runtime=undefined;throw error;}));
  // Preserve GSAP's license notice in the self-contained exported source.
  const html=await compileArtifactHtml(input,manifest.entry,manifest.datasetIds.map(id=>input.datasets.find(d=>d.id===id)!),gsap);
  return {html,manifest};
}
