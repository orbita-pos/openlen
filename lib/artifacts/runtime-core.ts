import {resolve} from "node:path";
import {createArtifactDatabase} from "./database";
import {createArtifactEvents} from "./events";
import {createArtifactJobs} from "./jobs";
import {createArtifactStore} from "./store";
import {createR2ArtifactStorage,FilesystemArtifactStorage,type ArtifactStorage} from "./private-storage";
import {createArtifactPreview,previewConfig} from "./preview";
import {ArtifactError} from "./types";
export {artifactsEnabled} from "./enabled";
/** Worker/preview processes need no auth, provider, app-query or chat runtime. */
export function createArtifactCoreRuntime(env:Readonly<Record<string,string|undefined>>){
  if(!env.DATABASE_URL)throw new ArtifactError("database_unavailable");
  const database=createArtifactDatabase(env.DATABASE_URL),store=createArtifactStore(database);
  let storage:Promise<ArtifactStorage>|null=null;
  const load=async():Promise<ArtifactStorage>=>{
    if(env.R2_ARTIFACTS_BUCKET&&env.R2_ACCOUNT_ID&&env.R2_ACCESS_KEY&&env.R2_SECRET_KEY)return createR2ArtifactStorage({accountId:env.R2_ACCOUNT_ID,bucket:env.R2_ARTIFACTS_BUCKET,accessKeyId:env.R2_ACCESS_KEY,secretAccessKey:env.R2_SECRET_KEY});
    if(!env.OPENLEN_ARTIFACTS_DIR&&env.NODE_ENV==="production")throw new ArtifactError("private_storage_unavailable");
    const root=resolve(env.OPENLEN_ARTIFACTS_DIR??".artifacts-private");
    if(root.replace(/\\/g,"/").toLowerCase().split("/").includes("public"))throw new ArtifactError("private_storage_unavailable");
    return new FilesystemArtifactStorage(root);
  };
  const getStorage=()=>storage??=load().catch(error=>{storage=null;throw error;});
  return {database,store,jobs:createArtifactJobs(database,store),events:createArtifactEvents(database),storage:getStorage,preview:async()=>{const config=previewConfig(env);if(!config)throw new ArtifactError("preview_unavailable");return createArtifactPreview(database,store,await getStorage(),config);},close:()=>database.close()};
}
