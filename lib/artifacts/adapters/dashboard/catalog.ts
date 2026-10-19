import {createHash} from "node:crypto";
import {readFile,lstat,realpath} from "node:fs/promises";
import path from "node:path";
import {catalogo,RAIZ_VENDOR,ficherosDelCatalogo} from "../../../apps/dependencias";
import {ArtifactError} from "../../types";

/** Trusted immutable catalog only. No installs, lock resolution or network. */
export async function artifactCatalog(id:string,root=process.env.OPENLEN_APP_VENDOR_DIR?.trim()||path.join(process.cwd(),"public/app-vendor")){
 const known=catalogo(id);
 if(!known)throw new ArtifactError("artifact_catalog_unavailable");
 try{
  const dir=path.join(root,id),actualRoot=await realpath(root),actual=await realpath(dir);
  if(!actual.startsWith(actualRoot+path.sep)||(await lstat(dir)).isSymbolicLink())throw new Error("outside catalog");
  const read=async(relative:string)=>{
   const file=path.join(dir,relative),stat=await lstat(file);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024||!(await realpath(file)).startsWith(actual+path.sep))throw new Error("invalid catalog file");
   return readFile(file);
  };
  const manifest=JSON.parse((await read("manifest.json")).toString("utf8"));
  if(manifest.catalogo!==id||!manifest.ficheros?.produccion)throw new Error("invalid manifest");
  await Promise.all(ficherosDelCatalogo(id).map(async(name)=>{
   if(!/^[\w.-]+\.js$/.test(name))throw new Error("invalid catalog path");
   const bytes=await read(`produccion/${name}`);
   if(manifest.ficheros.produccion[name]!==`sha256-${createHash("sha256").update(bytes).digest("base64")}`)throw new Error("catalog hash mismatch");
  }));
  const prefix=`${RAIZ_VENDOR}/${id}/`;
  return {catalogFiles:Object.fromEntries(known.dependencias.map(d=>[d.especificador,prefix+d.fichero])),vendorRoots:{[prefix]:path.join(dir,"produccion")}};
 }catch{throw new ArtifactError("artifact_catalog_invalid","Install the original production catalog and manifest; its files are missing or changed.");}
}
