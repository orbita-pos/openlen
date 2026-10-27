import {createArtifactDatabase} from "./database";
import {createArtifactEvents} from "./events";
import {createArtifactJobs} from "./jobs";
import {createArtifactStore} from "./store";
import {privateStorageFromEnv,type ArtifactStorage} from "./private-storage";
import {createArtifactPreview,previewConfig} from "./preview";
import {ArtifactError} from "./types";
export {artifactsEnabled} from "./enabled";
/** Worker/preview processes need no auth, provider, app-query or chat runtime. */
export function createArtifactCoreRuntime(env:Readonly<Record<string,string|undefined>>){
  if(!env.DATABASE_URL)throw new ArtifactError("database_unavailable");
  const database=createArtifactDatabase(env.DATABASE_URL),store=createArtifactStore(database);
  let storage:Promise<ArtifactStorage>|null=null;
  const load=():Promise<ArtifactStorage>=>privateStorageFromEnv(env);
  const getStorage=()=>storage??=load().catch(error=>{storage=null;throw error;});
  return {database,store,jobs:createArtifactJobs(database,store),events:createArtifactEvents(database),storage:getStorage,preview:async()=>{const config=previewConfig(env);if(!config)throw new ArtifactError("preview_unavailable");return createArtifactPreview(database,store,await getStorage(),config);},close:()=>database.close()};
}
