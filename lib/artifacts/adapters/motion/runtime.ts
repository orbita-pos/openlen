import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import type { SealedArtifactInput } from "../../types";
import { compileArtifactHtml } from "../dashboard/compile";
import { motionManifest } from "./manifest";
const load=createRequire(import.meta.url);
let runtime:Promise<string>|undefined;
export async function buildMotion(input:SealedArtifactInput){
  const manifest=motionManifest(input);
  const gsap=await(runtime??=readFile(load.resolve("gsap/dist/gsap.min.js"),"utf8").catch(error=>{runtime=undefined;throw error;}));
  // Preserve GSAP's license notice in the self-contained exported source.
  const html=await compileArtifactHtml(input,manifest.entry,manifest.datasetIds.map(id=>input.datasets.find(d=>d.id===id)!),gsap);
  return {html,manifest};
}
