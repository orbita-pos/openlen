import {build} from "esbuild";
import {createRequire} from "node:module";
import {mkdir,writeFile,copyFile,readFile,lstat,realpath,unlink,rmdir,readdir} from "node:fs/promises";
import path from "node:path";
const require=createRequire(import.meta.url);
async function main(){
const {nodeFileTrace}=require("next/dist/compiled/@vercel/nft");
const root=process.cwd(),staging=path.join(root,".next","artifacts-entry"),target=path.join(root,".next","standalone");
await mkdir(staging,{recursive:true});await mkdir(path.join(target,"artifacts"),{recursive:true});
const sources=[{entry:"scripts/artifacts-worker.ts",name:"worker.mjs"},{entry:"scripts/artifacts-preview.ts",name:"preview.mjs"}];
const entries=[];
for(const source of sources){
  const outfile=path.join(staging,source.name);
  await build({entryPoints:[source.entry],outfile,bundle:true,platform:"node",format:"esm",target:"node22",tsconfig:"tsconfig.json",alias:{"server-only":path.join(root,"node_modules/server-only/empty.js")},external:["@openlen/*","@inariwatch/capture/auto","pg-native","tailwindcss","postcss"],banner:{js:"import '@inariwatch/capture/auto'; import { createRequire as __artifactRequire } from 'node:module'; const require = __artifactRequire(import.meta.url);"},logLevel:"warning"});
  entries.push(outfile);
}
const assets=["lib/apps/bundler/bundler-worker.mjs","lib/functions/bundler/resolve.mjs","lib/backend/sql-split-worker.mjs","lib/backend/sql-split.mjs","node_modules/esbuild-wasm/lib/browser.js","node_modules/esbuild-wasm/esbuild.wasm","node_modules/gsap/dist/gsap.min.js","node_modules/gsap/package.json"];
// Tailwind reads this relative to its own CJS module. Bundling it into ESM
// would lose __dirname; externalize the package and trace its runtime instead.
assets.push(path.relative(root,require.resolve("tailwindcss/lib/css/preflight.css")));
// The artifact compiler bundles only locally installed production catalogs.
// Trace intentionally excludes public/, so materialize their manifests/files.
for(const id of await readdir(path.join(root,"public/app-vendor"))){
  if(!/^\d{4}-\d{2}$/.test(id))continue;
  const manifestPath=`public/app-vendor/${id}/manifest.json`;
  const manifest=JSON.parse(await readFile(path.join(root,manifestPath),"utf8"));
  if(manifest.catalogo!==id||!manifest.ficheros?.produccion)throw new Error("Invalid artifact catalog manifest");
  assets.push(manifestPath);
  for(const name of Object.keys(manifest.ficheros.produccion)){
    if(!/^[\w.-]+\.js$/.test(name))throw new Error("Invalid artifact catalog path");
    assets.push(`public/app-vendor/${id}/produccion/${name}`);
  }
}
const imageNativeRoot=await realpath(path.dirname(require.resolve("@openlen/images")));
for(const name of await readdir(imageNativeRoot))if(name==="index.js"||name==="package.json"||name.endsWith(".node"))assets.push(path.relative(root,path.join(imageNativeRoot,name)));
const trace=await nodeFileTrace([...entries,...assets.filter(p=>/\.m?js$/.test(p)&&!p.startsWith("public/")).map(p=>path.join(root,p))],{base:root,processCwd:root,ignore:["**/.git/**","**/.env*","**/.claude/**","**/.superpowers/**","**/plans/**","**/reports/**","**/research_notes/**","**/.artifacts-private/**","**/public/**","**/.next/standalone/**"]});
const unsupportedWarnings=[];
for(const warning of trace.warnings){
  const message=String(warning.message);
  // Capture's zero-dependency Node runtime probes optional browser, database
  // and framework integrations dynamically, each behind its own try/catch.
  // Missing external integrations are fine; missing relative SDK files aren't.
  const optionalCaptureIntegration=/Cannot find module '[^./][^']*' loaded from .*node_modules[\\/]@inariwatch[\\/]capture[\\/]dist[\\/]/.test(message);
  const unusedCatalogDevProbe=/Cannot find module '(?:react|react-dom(?:\/client)?)' loaded from .*public[\\/]app-vendor[\\/]test-kit-[^\\/]+[\\/]desarrollo[\\/]/.test(message);
  // Tailwind probes the obsolete plugin inside try/catch only to warn that
  // line-clamp is built into core. This compiler always passes plugins: [].
  const optionalTailwindProbe=/Cannot find module '@tailwindcss\/line-clamp' loaded from .*node_modules[\\/]tailwindcss[\\/]lib[\\/]util[\\/]validateConfig\.js/.test(message);
  const otherNativePlatform=/crates[\\/]images[\\/]openlen-images\.[^'\s]+\.node/.test(message);
  if(!optionalCaptureIntegration&&!unusedCatalogDevProbe&&!optionalTailwindProbe&&!otherNativePlatform&&!/pg-native|bufferutil|utf-8-validate|cloudflare:sockets|__next|@openlen\//.test(message))unsupportedWarnings.push(message);
}
if(unsupportedWarnings.length)throw new Error(unsupportedWarnings.join("\n"));
const files=new Set([...trace.fileList,...assets]);const links=[{relative:"node_modules/@openlen/images",actual:imageNativeRoot}],copiedPaths=new Set();let copied=0;
const inside=(base,file)=>{const relative=path.relative(base,file);return relative!==""&&!relative.startsWith("..")&&!path.isAbsolute(relative);};
const actualTarget=await realpath(target);if(!inside(root,actualTarget))throw new Error("Standalone output resolves outside the checkout");
for(const relative of files){
  const source=path.resolve(root,relative);
  if(!(await lstat(source)).isSymbolicLink())continue;
  const actual=await realpath(source);
  if(!/^node_modules[\\/]@openlen[\\/][a-z-]+$/.test(relative)||!inside(path.join(root,"crates"),actual))throw new Error("Unsupported worker dependency link");
  if(!links.some(link=>link.relative.replace(/\\/g,"/")===relative.replace(/\\/g,"/")))links.push({relative,actual});
}
for(const {relative} of links){
  const destination=path.resolve(target,relative),existing=await lstat(destination).catch(()=>null);
  if(!inside(target,destination))throw new Error("Unsafe native output");
  if(existing?.isSymbolicLink())await unlink(destination).catch(async error=>{if(!["EPERM","EISDIR"].includes(error.code))throw error;await rmdir(destination);});
  await mkdir(destination,{recursive:true});
}
async function copySafe(source,destination){
  await mkdir(path.dirname(destination),{recursive:true});
  const parent=await realpath(path.dirname(destination));
  if((parent!==actualTarget&&!inside(actualTarget,parent))||(await lstat(destination).catch(()=>null))?.isSymbolicLink())throw new Error("Worker output crosses a host link");
  await copyFile(source,destination);copied++;copiedPaths.add(path.relative(target,destination).replace(/\\/g,"/"));
}
for(const relative of files){
  const source=path.resolve(root,relative);
  if(!inside(root,source)||/(^|[\\/])\.env(?:[.\\/]|$)/.test(relative))throw new Error("Unsafe worker trace path");
  const stat=await lstat(source);
  if(stat.isSymbolicLink()){
    const actual=await realpath(source);
    if(!/^node_modules[\\/]@openlen[\\/][a-z-]+$/.test(relative)||!inside(path.join(root,"crates"),actual))throw new Error("Unsupported worker dependency link");
    continue;
  }
  if(!stat.isFile())continue;
  const isEntry=entries.includes(source),destination=isEntry?path.join(target,"artifacts",path.basename(source)):path.resolve(target,relative);
  if(!inside(target,destination))throw new Error("Unsafe worker destination");
  await copySafe(source,destination);
}
// Materialize only the traced native-package files, never a recursive copy of
// Rust target/ or a link back into the developer's host checkout.
for(const link of links)for(const relative of files){
  const source=path.resolve(root,relative);
  if(!inside(link.actual,source)||(await lstat(source)).isDirectory())continue;
  const destination=path.join(target,link.relative,path.relative(link.actual,source));
  if(!inside(target,destination))throw new Error("Unsafe native worker file");
  await copySafe(source,destination);
}
await writeFile(path.join(target,"artifacts","install.json"),JSON.stringify({version:1,entries:sources.map(s=>s.name),gsap:"3.15.0",files:copied,filesList:[...copiedPaths].sort(),containerVerified:false},null,2));
console.log(`Artifact worker/preview bundled with ${copied} traced files. Run worker.mjs --verify-install from the standalone root; Linux renderer acceptance is separate.`);
}
main().catch(error=>{console.error(String(error.message).slice(0,1000));process.exitCode=1;});
