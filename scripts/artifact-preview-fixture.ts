import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {artifactFixture} from "../lib/artifacts/testing/fixture";
import {createArtifactPreview,previewConfig} from "../lib/artifacts/preview";
import {createArtifactPreviewHttpServer} from "../lib/artifacts/preview-http";
async function main(){
  if(!process.argv[2])throw new Error("Pass an explicit synthetic HTML fixture");
  const f=await artifactFixture(),{ctx,artifact}=await f.create("project","dashboard");
  const config=previewConfig({OPENLEN_ARTIFACT_PREVIEW_ORIGIN:"http://preview.openlen.localhost:38419",NEXT_PUBLIC_SITE_URL:"http://app.openlen.localhost:38418"})!;
  const original=await readFile(process.argv[2],"utf8");
  const probe=`<script>window.previewProbe={origin:self.origin};try{document.cookie;window.previewProbe.cookieBlocked=false;}catch{window.previewProbe.cookieBlocked=true;}try{parent.document.title;window.previewProbe.parentBlocked=false;}catch{window.previewProbe.parentBlocked=true;}parent.postMessage({kind:"preview-fixture",probe:window.previewProbe},${JSON.stringify(config.appOrigin)});</script>`;
  const bytes=new TextEncoder().encode(original.replace("</body>",probe+"</body>"));
  const output={key:"synthetic/dashboard.html",hash:createHash("sha256").update(bytes).digest("hex"),mime:"text/html",format:"html",bytes:bytes.length};
  await f.store.writeArtifactFiles(ctx,artifact.id,0,{"index.html":original});await f.store.sealArtifactRevision(ctx,artifact.id,1);
  await f.database.query(`update "artifactRevisions" set "outputs"=$3::jsonb,"evidence"=$4::jsonb where "artifactId"=$1 and "revision"=$2`,[artifact.id,1,JSON.stringify([output]),JSON.stringify({valid:true})]);
  const preview=createArtifactPreview(f.database,f.store,{get:async()=>bytes,put:async()=>{},delete:async()=>{}},config);
  const child=createArtifactPreviewHttpServer(preview,config);
  const parent=createServer(async(req,res)=>{
    if(req.url!=="/"){res.writeHead(404);res.end();return;}
    const grant=await preview.mint(ctx,artifact.id,1,0);
    res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store","set-cookie":"app-session-synthetic=fixture-only; Path=/; HttpOnly; SameSite=Strict"});
    res.end(`<!doctype html><html><head><title>Trusted preview fixture</title></head><body style="margin:0"><iframe id="preview" title="Private artifact" style="width:1280px;height:720px;border:0" src="${grant.url}"></iframe><script>window.previewMessages=[];addEventListener('message',event=>{if(event.source===document.getElementById('preview').contentWindow)window.previewMessages.push({origin:event.origin,data:event.data});});</script></body></html>`);
  });
  child.listen(38419,"127.0.0.1");parent.listen(38418,"127.0.0.1",()=>console.log("Synthetic isolated preview fixture ready; no application database or provider calls"));
  const shutdown=()=>{child.close();parent.close();void f.pg.close();};process.once("SIGINT",shutdown);process.once("SIGTERM",shutdown);
}
main().catch(()=>{console.error("Synthetic preview fixture failed");process.exitCode=1;});
