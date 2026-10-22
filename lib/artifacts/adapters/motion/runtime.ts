import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import type { SealedArtifactInput } from "../../types";
import { compileArtifactHtml } from "../dashboard/compile";
import { motionManifest } from "./manifest";
let runtime:Promise<string>|undefined;
/** GSAP's default force3D "auto" writes translate3d while a tween runs and a 2D transform at rest, so Chromium
 *  layers an element only mid-tween and paints the same instant differently depending on the frames before it
 *  (trial G2: a scale over an app capture failed the seek check 3 of 3). Always 2D, a frame depends on its time
 *  alone; an explicit z, rotationX/Y or a tween's own force3D still gets 3D. */
const FRAME_IS_A_FUNCTION_OF_TIME="gsap.config({force3D:false});";
/** `checkOnly`: compile without GSAP — what render_artifact checks before queuing. The Next server bundles this
 *  file, and resolving gsap from a bundle fails (trial E); only the worker reads it, lazily. */
export async function buildMotion(input:SealedArtifactInput,options:{checkOnly?:boolean}={}){
  const manifest=motionManifest(input);
  const gsap=options.checkOnly?"":await(runtime??=readFile(createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"),"utf8").then(source=>`${source}\n${FRAME_IS_A_FUNCTION_OF_TIME}`).catch(error=>{runtime=undefined;throw error;}));
  // Preserve GSAP's license notice in the self-contained exported source.
  const html=await compileArtifactHtml(input,manifest.entry,manifest.datasetIds.map(id=>input.datasets.find(d=>d.id===id)!),gsap);
  return {html,manifest};
}
