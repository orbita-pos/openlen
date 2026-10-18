import {createServer} from "node:http";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {artifactFixture} from "../lib/artifacts/testing/fixture";
import {createArtifactSourceFreeze} from "../lib/artifacts/context";
import {projectSourceLoader} from "../lib/artifacts/project-data";
import {buildProjectCaptures} from "../lib/artifacts/adapters/motion/captures";
import {stopBundlerWorker} from "../lib/apps/bundler/bundle-app";
import type {SealedArtifactInput} from "../lib/artifacts/types";

/** A real functional but synthetic source project in an isolated PGlite DB.
 * Exercises the product source loader/freeze/compiler. No customer data,
 * provider, application DB or paid call is used. */
async function main(){
  if(!process.argv[2])throw Error("Pass an explicit fixture output directory");
  const directory=resolve(process.argv[2]),f=await artifactFixture();
  let server:ReturnType<typeof createServer>|undefined;
  try{
    await f.pg.exec(`alter table "projects" add column "data" jsonb;create table "projectFiles"("projectId" text,"path" text,"content" text);`);
    const html='<!doctype html><html lang="es"><head><title>Inventario — proyecto sintético</title><link rel="stylesheet" href="/styles.css"><link rel="icon" href="data:,"></head><body><header><span>PROYECTO DE PRUEBA / CAPTURA REAL</span><h1>Mi inventario</h1><p id="version">Versión original 1</p></header><main><section><p>Productos disponibles</p><strong id="stock">21</strong><button id="add">Agregar 3 unidades</button></section><section><h2>Catálogo de demostración</h2><p>Taza · 12 unidades</p><p>Libreta · 9 unidades</p><small>Datos sintéticos locales. Sin sesión ni base de clientes.</small></section></main><script src="/src/main.ts" type="module"></script></body></html>';
    const css='*{box-sizing:border-box}body{margin:0;padding:64px;background:#121b23;color:#f3f4ee;font:22px Arial}header{border-bottom:1px solid #38505c;padding-bottom:24px}header span{font-size:14px;color:#8ad7af;letter-spacing:2px}h1{font-size:56px;margin:18px 0}#version,small{color:#a2b4bf;font-size:16px}main{display:grid;grid-template-columns:1fr 1.4fr;gap:80px;padding-top:42px}strong{display:block;color:#8ad7af;font-size:104px}button{margin-top:20px;padding:14px 20px;font:18px Arial;background:#8ad7af;border:0;color:#12201a;border-radius:6px}h2{font-size:28px}';
    const source='let stock:number=21;document.querySelector("#add").addEventListener("click",()=>{stock+=3;document.querySelector("#stock").textContent=String(stock);});';
    const project={html,app:{entrada:"/src/main.ts",catalogo:"2026-11"},settings:{languages:["es"]}};
    await f.database.query(`update "projects" set "data"=$1::jsonb where "id"='project'`,[JSON.stringify(project)]);
    await f.database.query(`insert into "projectFiles" values ('project','/src/main.ts',$1),('project','/styles.css',$2)`,[source,css]);
    const frozen=await createArtifactSourceFreeze(f.database,projectSourceLoader(f.database))(f.owner,["/index.html","/src/main.ts","/styles.css"]);
    const {ctx,artifact}=await f.create("project","motion");
    const manifest={version:1,entry:"index.html",runtime:"gsap-3.15.0",width:1280,height:720,fps:30,durationSeconds:1,datasetIds:[],captures:[{id:"inventory",entry:"/index.html"}]};
    const revision=await f.store.writeArtifactFiles(ctx,artifact.id,0,{...frozen.files,"motion.json":JSON.stringify(manifest),"index.html":'<html><head></head><body style="margin:0;background:#121b23"><img id="screen" src="asset:capture:inventory" width="1280" height="720"><script src="main.ts"></script></body></html>',"main.ts":'gsap.set("#screen",{opacity:.7});const tl=gsap.timeline({paused:true});tl.fromTo("#screen",{opacity:.7},{opacity:1,duration:1,immediateRender:false});tl.pause(0);gsap.ticker.sleep();window.lenMotion={durationSeconds:1,ready:async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));},seek:async(t:number)=>{tl.totalTime(t,true);}};'}, {sourceRef:frozen.sourceRef});
    // Change the source after freezing. The capture must still display v1.
    project.html=html.replace("Versión original 1","Versión posterior 2");
    await f.database.query(`update "projects" set "data"=$1::jsonb where "id"='project'`,[JSON.stringify(project)]);
    const input:SealedArtifactInput={artifact,revision,assets:[],datasets:[]},captures=await buildProjectCaptures(input);
    await mkdir(directory,{recursive:true});
    await writeFile(join(directory,"capture.html"),captures[0]!.html);
    await writeFile(join(directory,"packet.json"),JSON.stringify({version:1,kind:"capture",...captures[0],probes:[]}));
    await writeFile(join(directory,"input.json"),JSON.stringify(input));
    await writeFile(join(directory,"proof.json"),JSON.stringify({projectType:"app",sourceChangedAfterFreeze:true,frozenSourceVersion:1,currentSourceVersion:2,customerData:false,containerVerified:false},null,2));
    console.log("Frozen source fixture compiled: original v1 retained after source app changed to v2.");
    if(process.argv.includes("--serve")){
      server=createServer((req,res)=>{
        if(req.method!=="GET"||req.url!=="/"){res.writeHead(404);res.end();return;}
        res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"});res.end(captures[0]!.html);
      });
      await new Promise<void>(resolve=>server!.listen(38422,"127.0.0.1",resolve));
      console.log("Synthetic frozen app: http://capture.openlen.localhost:38422/");
      await new Promise<void>(resolve=>{const stop=()=>{server!.close();resolve();};process.once("SIGINT",stop);process.once("SIGTERM",stop);});
    }
  }finally{server?.close();stopBundlerWorker();await f.pg.close();}
}
main().catch(error=>{console.error(`Source capture fixture failed: ${error instanceof Error?error.message.slice(0,300):"unknown"}`);stopBundlerWorker();process.exitCode=1;});
