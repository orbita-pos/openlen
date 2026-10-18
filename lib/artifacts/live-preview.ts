import type {ArtifactDataset} from "./types";
import {artifactDatasetForDisplay} from "./dataset-display";
export interface ArtifactLiveView {readonly id:string;readonly artifactId:string;readonly revision:number;readonly liveDatasetIds:readonly string[]}
export type ArtifactLiveRefresh=(input:{revision:number;datasetId:string},signal:AbortSignal)=>Promise<{dataset:ArtifactDataset;revision:number}>;
const codes=new Set(["artifact_not_found","forbidden","revision_conflict","data_refresh_busy","data_query_timeout","data_query_failed","data_source_unavailable","live_dataset_not_found","live_dashboard_required"]);
export class ArtifactLivePreviewError extends Error {constructor(readonly code:string){super(code);}}
function displayDataset(dataset:ArtifactDataset,id:string){
  if(!dataset||dataset.id!==id||dataset.mode!=="live"||!Array.isArray(dataset.columns)||dataset.columns.length>64||!Array.isArray(dataset.rows)||dataset.rows.length>500||!Number.isFinite(Date.parse(dataset.capturedAt)))throw new ArtifactLivePreviewError("data_refresh_failed");
  const result=artifactDatasetForDisplay(dataset);
  if(new TextEncoder().encode(JSON.stringify(result)).length>2*1024*1024)throw new ArtifactLivePreviewError("data_refresh_failed");
  return result;
}
/** Parent-side bridge. Keep project/artifact identity in this trusted closure.
 * A transferred reply port belongs to the requesting document, so a later
 * iframe navigation cannot receive old private data through a WindowProxy. */
export function connectArtifactLivePreview(options:{frame:Window;view:ArtifactLiveView;refresh:ArtifactLiveRefresh}){
  const {frame,view,refresh}=options;
  let revision=view.revision,disposed=false,active:{controller:AbortController;port:MessagePort}|null=null;
  const seen=new Set<string>(),allowed=new Set(view.liveDatasetIds);
  const handle=async(event:MessageEvent)=>{
    const data=event.data as Record<string,unknown>|null;
    if(disposed||event.source!==frame||event.origin!=="null"||!data||data.kind!=="openlen.artifact.live.request"||data.channel!==view.id||event.ports.length!==1||typeof data.requestId!=="string"||!/^[a-zA-Z0-9_-]{1,80}$/.test(data.requestId)||typeof data.datasetId!=="string"||data.datasetId.length>100||Object.keys(data).some(k=>!["kind","channel","requestId","datasetId"].includes(k)))return;
    const port=event.ports[0]!;
    const reject=(code:string)=>{try{port.postMessage({ok:false,code});}finally{port.close();}};
    if(!allowed.has(data.datasetId)){reject("live_dataset_not_found");return;}
    if(active){reject("data_refresh_busy");return;}
    if(seen.has(data.requestId)||seen.size>=256){reject("live_request_replayed");return;}
    seen.add(data.requestId);
    const controller=new AbortController();active={controller,port};
    try{
      const result=await refresh({revision,datasetId:data.datasetId},controller.signal);
      if(disposed||controller.signal.aborted)return;
      if(result.revision!==revision+1)throw new ArtifactLivePreviewError("revision_conflict");
      const dataset=displayDataset(result.dataset,data.datasetId);revision=result.revision;
      port.postMessage({ok:true,dataset,revision});
    }catch(error){if(!disposed&&!controller.signal.aborted)port.postMessage({ok:false,code:error instanceof ArtifactLivePreviewError&&codes.has(error.code)?error.code:"data_refresh_failed"});}
    finally{port.close();active=null;}
  };
  const listener=(event:MessageEvent)=>{void handle(event);};
  if(typeof window!=="undefined")window.addEventListener("message",listener);
  return {handle,dispose(){disposed=true;active?.controller.abort();active?.port.close();if(typeof window!=="undefined")window.removeEventListener("message",listener);}};
}
/** This request stays in the authenticated parent. No cookies, SQL or API URL
 * are sent to the iframe. Server-side membership/owner checks remain decisive. */
export function artifactLiveRefreshClient(projectId:string,artifactId:string):ArtifactLiveRefresh{
  return async(input,signal)=>{
    const response=await fetch(`/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/refresh`,{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify(input),signal});
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result)throw new ArtifactLivePreviewError(codes.has(result?.error)?result.error:"data_refresh_failed");
    return result;
  };
}
