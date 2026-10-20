import type {ArtifactKind, ArtifactStatus} from "@/lib/artifacts/types";

export type ArtifactSummary = {
  id:string; projectId:string; requestId:string; title:string; kind:ArtifactKind;
  currentRevision:number; lastReadyRevision:number|null; status:ArtifactStatus;
  createdAt:string; updatedAt:string;
};
export type ArtifactOutputInfo = {index:number;format:string;mime:string;bytes:number;name:string};
export type ArtifactInspection = {
  artifact:ArtifactSummary;
  revision:{artifactId:string;revision:number;outputs:ArtifactOutputInfo[];evidence:{valid:boolean}|null};
  jobs:{id:string;revision:number;status:string;createdAt:string}[];
};
export type ArtifactFetch = (url:string,init?:RequestInit)=>Promise<Response>;
export const artifactFetch:ArtifactFetch=(url,init)=>fetch(url,init);
export class ArtifactClientError extends Error {
  constructor(readonly code:string,readonly status=0){super(code);}
}
export const activeStatus=(status:string)=>["queued","running","validating","storing"].includes(status);
export const artifactBase=(projectId:string)=>`/api/projects/${encodeURIComponent(projectId)}/artifacts`;
export const artifactUrl=(projectId:string,id:string)=>`${artifactBase(projectId)}/${encodeURIComponent(id)}`;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const revision=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
const kinds=["dashboard","slides","image","motion","audio"];
const statuses=["draft","queued","running","validating","storing","ready","failed","cancelled","needs_attention"];
export function cursorAfter(a:string,b:string):boolean {
  for(const c of [a,b])if(!/^\d{1,19}$/.test(c)||BigInt(c)>9223372036854775807n)throw new ArtifactClientError("invalid_cursor");
  return BigInt(a)>BigInt(b);
}
export function parseArtifactList(value:unknown):ArtifactSummary[]{
  if(!record(value)||!Array.isArray(value.artifacts)||!value.artifacts.every(a=>record(a)&&
    ["id","projectId","requestId","title","createdAt","updatedAt"].every(k=>typeof a[k]==="string")&&
    kinds.includes(String(a.kind))&&statuses.includes(String(a.status))&&revision(a.currentRevision)&&
    (a.lastReadyRevision===null||(revision(a.lastReadyRevision)&&a.lastReadyRevision<=a.currentRevision))&&
    (a.status!=="ready"||a.lastReadyRevision!==null)))throw new ArtifactClientError("invalid_response");
  return value.artifacts as ArtifactSummary[];
}
export function artifactFileUrl(projectId:string,id:string,rev:number,index:number){
  if(!revision(rev)||!revision(index))throw new ArtifactClientError("invalid_file_reference");
  return `${artifactUrl(projectId,id)}/files/${index}?revision=${rev}`;
}
export function validatePreviewUrl(value:string,appOrigin:string){
  const url=new URL(value),app=new URL(appOrigin);
  const local=["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.hostname.endsWith(".localhost");
  if((url.protocol!=="https:"&&!(local&&url.protocol==="http:"))||url.hostname===app.hostname||
    url.username||url.password||url.search||url.hash||!/^\/grant\/[A-Za-z0-9_-]{43}$/.test(url.pathname))throw new ArtifactClientError("invalid_preview");
  return url.href;
}
export async function artifactJson(fetcher:ArtifactFetch,url:string,init:RequestInit={}):Promise<unknown>{
  const response=await fetcher(url,{credentials:"same-origin",cache:"no-store",...init});
  const data:unknown=await response.json().catch(()=>null);
  if(!response.ok)throw new ArtifactClientError(record(data)&&typeof data.error==="string"?data.error:"unavailable",response.status);
  if(!record(data))throw new ArtifactClientError("invalid_response");
  return data;
}
export async function inspectArtifact(fetcher:ArtifactFetch,projectId:string,id:string,rev:number|undefined,signal?:AbortSignal):Promise<ArtifactInspection>{
  const value=await artifactJson(fetcher,`${artifactUrl(projectId,id)}${rev===undefined?"":`?revision=${rev}`}`,{signal});
  if(!record(value)||!record(value.revision)||!Array.isArray(value.jobs))throw new ArtifactClientError("invalid_response");
  parseArtifactList({artifacts:[value.artifact]});
  const r=value.revision;
  if(r.artifactId!==id||!revision(r.revision)||(rev!==undefined&&r.revision!==rev)||!Array.isArray(r.outputs)||!r.outputs.every(o=>record(o)&&revision(o.index)&&typeof o.format==="string"&&typeof o.mime==="string"&&typeof o.name==="string"&&typeof o.bytes==="number"&&o.bytes>=0)||!value.jobs.every(j=>record(j)&&typeof j.id==="string"&&revision(j.revision)&&typeof j.status==="string"&&typeof j.createdAt==="string"))throw new ArtifactClientError("invalid_response");
  if((value.artifact as ArtifactSummary).id!==id||(value.artifact as ArtifactSummary).projectId!==projectId)throw new ArtifactClientError("invalid_response");
  return value as ArtifactInspection;
}
