import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {ArtifactError,type ArtifactSql} from "./types";
const exec=promisify(execFile);
const namePattern=/^openlen-artifact-([a-f0-9-]{36})$/;
export type DockerControl=(args:string[])=>Promise<{code:number;stdout:string}>;
const control:DockerControl=async args=>{
  try{const result=await exec("docker",args,{timeout:10_000,maxBuffer:64*1024});return {code:0,stdout:result.stdout};}
  catch{return {code:1,stdout:""};}
};
async function names(run:DockerControl):Promise<string[]>{
  const result=await run(["ps","-a","--filter","label=openlen.artifact-renderer=1","--format","{{.Names}}"]);
  if(result.code!==0)throw new ArtifactError("renderer_cleanup_unknown");
  const list=result.stdout.split(/\r?\n/).filter(Boolean);
  if(list.length>100||list.some(name=>!namePattern.test(name)))throw new ArtifactError("renderer_cleanup_unknown");
  return list;
}
export async function removeArtifactContainer(name:string,run:DockerControl=control):Promise<void>{
  if(!namePattern.test(name))throw new ArtifactError("invalid_renderer_config");
  await run(["rm","-f",name]);
  // rm may fail because --rm already removed it. Only a successful inventory
  // confirming absence proves it is safe to release the output directory.
  if((await names(run)).includes(name))throw new ArtifactError("renderer_cleanup_unknown");
}
export async function reconcileArtifactContainers(database:ArtifactSql,run:DockerControl=control):Promise<void>{
  for(const name of await names(run)){
    const token=namePattern.exec(name)![1]!;
    const active=await database.query(`select "id" from "artifactJobs" where "fencingToken"=$1 and "status" in ('running','validating','storing') and "leaseUntil">now()`,[token]);
    if(!active.length)await removeArtifactContainer(name,run);
  }
}
