import { z } from "zod";
import { safeArtifactPath } from "../../state";
import { ArtifactError, type SealedArtifactInput } from "../../types";
import {audioTrackSchema} from "../audio/manifest";
export const CAPTURE_ROUTE=/^#\/[A-Za-z0-9\/_.~%-]{0,200}$/;
const schema=z.object({version:z.literal(1),entry:z.string(),runtime:z.literal("gsap-3.15.0"),width:z.literal(1280),height:z.literal(720),fps:z.literal(30),durationSeconds:z.number().finite().min(1).max(120),audio:z.object({tracks:z.array(audioTrackSchema).min(1).max(8),duckMusic:z.boolean().default(true)}).strict().optional(),datasetIds:z.array(z.string().min(1)).max(20).default([]),captures:z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),entry:z.string()}).strict()).max(4).default([])}).strict();
/** What is wrong with a motion.json's shape, by field, or null (the files it names are checked on render). */
export function motionManifestIssue(raw:unknown):string|null{
  const parsed=schema.safeParse(raw);
  if(parsed.success)return null;
  const issue=parsed.error.issues[0]!;
  return `${issue.path.join(".")||"(root)"}: ${issue.message}`;
}
/** What is wrong, by field: Len fixes motion.json from this message. */
export function motionManifest(input:SealedArtifactInput){
  const fail=(detail:string):never=>{throw new ArtifactError("invalid_motion_manifest",`motion.json ${detail}`);};
  let raw:unknown;
  try{raw=JSON.parse(input.revision.files["motion.json"]??"");}catch{throw new ArtifactError("invalid_motion_manifest","motion.json is not JSON");}
  const parsed=schema.safeParse(raw);
  if(!parsed.success){const issue=parsed.error.issues[0]!;return fail(`${issue.path.join(".")||"(root)"}: ${issue.message}`);}
  const value=parsed.data;
  if(!safeArtifactPath(value.entry)||!value.entry.endsWith(".html")||!Object.hasOwn(input.revision.files,value.entry))fail(`entry: "${value.entry}" is not an .html file of this video`);
  if(Math.abs(value.durationSeconds*value.fps-Math.round(value.durationSeconds*value.fps))>1e-6)fail(`durationSeconds: ${value.durationSeconds} s is not a whole number of frames at ${value.fps} fps`);
  if(new Set(value.datasetIds).size!==value.datasetIds.length)fail("datasetIds: an id appears twice");
  const unknown=value.datasetIds.find(id=>!input.datasets.some(d=>d.id===id));
  if(unknown!==undefined)fail(`datasetIds: "${unknown}" is not a dataset saved here`);
  if(new Set(value.captures.map(c=>c.id)).size!==value.captures.length)fail("captures: two captures share an id");
  for(const c of value.captures){
    // A screen of an app is its page plus a hash route, as the app navigates: "/index.html#/reservar".
    const [page,route]=[c.entry.split("#")[0]!,c.entry.includes("#")?c.entry.slice(c.entry.indexOf("#")):undefined];
    if(!page.startsWith("/")||!safeArtifactPath(page.slice(1))||!page.endsWith(".html"))fail(`captures: "${page}" is not an absolute path to an .html page of the project`);
    if(route!==undefined&&!CAPTURE_ROUTE.test(route))fail(`captures: "${route}" is not a route like #/reservar`);
  }
  return {...value,frameCount:Math.round(value.durationSeconds*value.fps)};
}
