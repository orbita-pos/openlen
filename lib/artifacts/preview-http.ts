import {createServer} from "node:http";
import type {ArtifactPreview,ArtifactPreviewConfig} from "./preview";
/** Reverse proxy only this loopback service on the configured preview host. */
export function createArtifactPreviewHttpServer(preview:ArtifactPreview,config:ArtifactPreviewConfig){
  const server=createServer(async(req,res)=>{
    if(req.url==="/healthz"&&req.method==="GET"){res.writeHead(200,{"content-type":"text/plain"});res.end("ok");return;}
    try{
      if(req.method!=="GET"||!req.url||req.url.length>2048||req.headers.host!==new URL(config.origin).host){res.writeHead(404);res.end();return;}
      const response=await preview.handle(new Request(config.origin+req.url,{headers:{cookie:req.headers.cookie??""}}));
      res.writeHead(response.status,Object.fromEntries(response.headers.entries()));res.end(Buffer.from(await response.arrayBuffer()));
    }catch{res.writeHead(503,{"cache-control":"no-store"});res.end();}
  });
  server.requestTimeout=10_000;server.headersTimeout=10_000;server.maxHeadersCount=30;
  return server;
}
