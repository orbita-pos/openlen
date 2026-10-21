import {createHash} from "node:crypto";
import {ArtifactError,type SealedArtifactInput} from "../../types";
import {safeArtifactPath} from "../../state";
import {compileArtifactHtml} from "../dashboard/compile";
import {motionManifest} from "./manifest";
/** Public source bytes were selected and frozen by the authenticated server.
 * Reconstruct only that selection; composition files cannot fill missing app
 * modules. Captures have no datasets, cookies, env or external resource fetch. */
export async function buildProjectCaptures(input:SealedArtifactInput){
  const manifest=motionManifest(input);
  if(!manifest.captures.length)return [];
  const ref=input.revision.sourceRef;
  if(ref?.frozenSourcePrefix!=="project-source/"||!Object.keys(ref.files).length)throw new ArtifactError("frozen_source_missing","captures need the app frozen first: create the video with freeze_source:true and source_paths [\"/index.html\"], or render_artifact with refresh_source_paths");
  const files:Record<string,string>=Object.create(null);
  for(const [path,expected] of Object.entries(ref.files)){
    if(!path.startsWith("/")||!safeArtifactPath(path.slice(1)))throw new ArtifactError("frozen_source_changed");
    const content=input.revision.files[`project-source${path}`];
    if(typeof content!=="string"||createHash("sha256").update(content).digest("hex")!==expected)throw new ArtifactError("frozen_source_changed",`project-source${path} changed after it was frozen; a capture shows the app as it was frozen, so never edit project-source/ or the app to make one. To take the app as it is now, render_artifact with refresh_source_paths ["/index.html"]`);
    files[path.slice(1)]=content;
  }
  const snapshot:SealedArtifactInput={...input,revision:{...input.revision,files,sourceRef:null},datasets:[],assets:[]};
  const result=[];
  for(const capture of manifest.captures){
    const hash=capture.entry.indexOf("#"),entry=(hash<0?capture.entry:capture.entry.slice(0,hash)).slice(1),route=hash<0?undefined:capture.entry.slice(hash);
    if(!Object.hasOwn(files,entry))throw new ArtifactError("frozen_source_missing",`captures: ${entry} was not frozen; list it in source_paths`);
    result.push({id:capture.id,width:1280,height:720,html:await compileArtifactHtml(snapshot,entry,[],"",ref.catalogo),...(route?{route}:{})});
  }
  return result;
}
