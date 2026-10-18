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
  if(ref?.frozenSourcePrefix!=="project-source/"||!Object.keys(ref.files).length)throw new ArtifactError("frozen_source_missing");
  const files:Record<string,string>=Object.create(null);
  for(const [path,expected] of Object.entries(ref.files)){
    if(!path.startsWith("/")||!safeArtifactPath(path.slice(1)))throw new ArtifactError("frozen_source_changed");
    const content=input.revision.files[`project-source${path}`];
    if(typeof content!=="string"||createHash("sha256").update(content).digest("hex")!==expected)throw new ArtifactError("frozen_source_changed");
    files[path.slice(1)]=content;
  }
  const snapshot:SealedArtifactInput={...input,revision:{...input.revision,files,sourceRef:null},datasets:[],assets:[]};
  const result=[];
  for(const capture of manifest.captures){
    const entry=capture.entry.slice(1);
    if(!Object.hasOwn(files,entry))throw new ArtifactError("frozen_source_missing");
    result.push({id:capture.id,width:1280,height:720,html:await compileArtifactHtml(snapshot,entry,[])});
  }
  return result;
}
