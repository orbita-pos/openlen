import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {build} from "esbuild";
import {artifactFixture} from "../lib/artifacts/testing/fixture";
import {dashboardFixture} from "../lib/artifacts/testing/dashboard";
import {buildDashboard} from "../lib/artifacts/adapters/dashboard/compile";
import {createArtifactData} from "../lib/artifacts/data";
import {createArtifactPreview,previewConfig} from "../lib/artifacts/preview";
import {createArtifactPreviewHttpServer} from "../lib/artifacts/preview-http";
import {stopBundlerWorker} from "../lib/apps/bundler/bundle-app";

/** Synthetic HTTP/message-port/SQL proof. No real app auth, customer DB, model
 * or provider is used. The production refresh route has separate auth checks. */
async function main(){
  const f=await artifactFixture(),{ctx,artifact}=await f.create("owner","dashboard");
  let reads=0;
  const data=createArtifactData(f.database,f.store,async()=>({kind:"rows",columns:["Zona","Ventas"],rows:[["Norte",120*++reads],["Sur",80*reads]],truncated:false}));
  const dataset=await data.queryArtifactData(ctx,artifact.id,{source:"visits",mode:"live",zone:"UTC"});
  const fixture=dashboardFixture(),files={...fixture.revision.files};
  const descriptor=JSON.parse(files["dashboard.json"]!);descriptor.datasetIds=[dataset.id];files["dashboard.json"]=JSON.stringify(descriptor);
  files["index.html"]=files["index.html"]!.replace("Escenario comercial","PRUEBA SINTÉTICA LIVE").replace("Ventas del escenario","Ventas sintéticas").replace("Valores hipotéticos para comparar zonas.","Datos sintéticos; sin base de clientes.").replace("</header>",'<button id="refresh" style="padding:12px">Actualizar prueba</button></header>');
  files["main.ts"]=files["main.ts"]!.replace("const d=","let d=")+`\nwindow.addEventListener('len:data',()=>{d=window.lenData.datasets[0];update();});document.querySelector('#refresh').addEventListener('click',async()=>{try{await window.lenLive.refresh(d.id);document.body.dataset.refresh='ok';}catch(e){document.body.dataset.refresh=e.message;}});`;
  const revision=await f.store.writeArtifactFiles(ctx,artifact.id,1,files);
  const compiled=await buildDashboard({artifact,revision,datasets:[dataset],assets:[]});
  const bytes=new TextEncoder().encode(compiled.html),output={key:"synthetic/live.html",hash:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,mime:"text/html",format:"html"};
  await f.store.sealArtifactRevision(ctx,artifact.id,revision.revision);
  await f.database.query(`update "artifactRevisions" set "outputs"=$3::jsonb,"evidence"=$4::jsonb where "artifactId"=$1 and "revision"=$2`,[artifact.id,revision.revision,JSON.stringify([output]),JSON.stringify({valid:true})]);
  const config=previewConfig({OPENLEN_ARTIFACT_PREVIEW_ORIGIN:"http://preview.openlen.localhost:38421",NEXT_PUBLIC_SITE_URL:"http://app.openlen.localhost:38420"})!;
  const preview=createArtifactPreview(f.database,f.store,{get:async()=>bytes,put:async()=>{},delete:async()=>{}},config),child=createArtifactPreviewHttpServer(preview,config);
  const bundle=await build({entryPoints:["lib/artifacts/live-preview.ts"],bundle:true,platform:"browser",format:"iife",globalName:"LenLiveParent",write:false});
  const bridgeCode=bundle.outputFiles[0]!.text.replace(/<\/script/gi,"<\\/script");
  const parent=createServer(async(req,res)=>{
    try{
      if(req.url===`/api/projects/${ctx.projectId}/artifacts/${artifact.id}/refresh`&&req.method==="POST"){
        let body="";for await(const chunk of req){body+=chunk;if(body.length>1024)throw Error("too large");}
        const input=JSON.parse(body);const refreshed=await data.refreshArtifactDataset(ctx,artifact.id,input.revision,input.datasetId);
        res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(refreshed));return;
      }
      if(req.url!=="/"||req.method!=="GET"){res.writeHead(404);res.end();return;}
      const grant=await preview.mint(ctx,artifact.id,revision.revision,0);
      res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store","set-cookie":"synthetic-app-session=fixture; Path=/; HttpOnly; SameSite=Strict"});
      res.end(`<!doctype html><html><head><title>Len live preview — synthetic proof</title></head><body style="margin:0;background:#18222b;color:#fff;font:16px system-ui"><p>Prueba sintética del puente live. Sin sesión real, datos de clientes ni proveedor.</p><iframe title="Live dashboard" id="viewer" src="${grant.url}" style="border:0;width:1280px;height:720px"></iframe><script>${bridgeCode}\nwindow.fixtureBridge=LenLiveParent.connectArtifactLivePreview({frame:document.getElementById('viewer').contentWindow,view:${JSON.stringify(grant.view)},refresh:LenLiveParent.artifactLiveRefreshClient(${JSON.stringify(ctx.projectId)},${JSON.stringify(artifact.id)})});</script></body></html>`);
    }catch{res.writeHead(503);res.end("synthetic refresh failed");}
  });
  await new Promise<void>(resolve=>child.listen(38421,"127.0.0.1",resolve));
  await new Promise<void>(resolve=>parent.listen(38420,"127.0.0.1",resolve));
  console.log("Synthetic live bridge: http://app.openlen.localhost:38420/ (200 -> 400, Norte -> 240)");
  const stop=()=>{child.close();parent.close();stopBundlerWorker();void f.pg.close();};
  process.once("SIGINT",stop);process.once("SIGTERM",stop);
}
main().catch(error=>{console.error(`Synthetic live proof failed: ${error instanceof Error?error.message.slice(0,300):"unknown"}`);stopBundlerWorker();process.exitCode=1;});
