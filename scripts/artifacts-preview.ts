import {createArtifactCoreRuntime,artifactsEnabled} from "../lib/artifacts/runtime-core";
import {previewConfig} from "../lib/artifacts/preview";
import {createArtifactPreviewHttpServer} from "../lib/artifacts/preview-http";
async function main(){
  if(!artifactsEnabled()){console.log("artifact preview: disabled");return;}
  const config=previewConfig(process.env);if(!config)throw new Error("preview origin is not configured");
  const runtime=createArtifactCoreRuntime(process.env),preview=await runtime.preview();
  const port=Number(process.env.OPENLEN_ARTIFACT_PREVIEW_PORT??3012);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error("invalid preview port");
  const server=createArtifactPreviewHttpServer(preview,config);
  server.listen(port,"127.0.0.1",()=>console.log("artifact preview ready on loopback"));
  const shutdown=()=>{server.close(()=>{void runtime.close();});};
  process.once("SIGINT",shutdown);process.once("SIGTERM",shutdown);
}
main().catch(()=>{console.error("artifact preview failed; check private configuration and monitoring");process.exitCode=1;});
