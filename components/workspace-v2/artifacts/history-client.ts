import {artifactBase,artifactJson,ArtifactClientError,parseArtifactList,type ArtifactFetch,type ArtifactSummary} from "./client";
export type HistoryFilters={q?:string;kind?:string;status?:string;until?:string};
export type HistoryPage={artifacts:ArtifactSummary[];nextCursor:string|null};
export function historyQuery(filters:HistoryFilters){
  const params=new URLSearchParams({history:"1",limit:"24"});
  for(const key of ["q","kind","status","until"] as const)if(filters[key])params.set(key,filters[key]!);
  return params.toString();
}
export async function fetchHistoryPage(fetcher:ArtifactFetch,projectId:string,query:string,before:string|null,signal:AbortSignal):Promise<HistoryPage>{
  const params=new URLSearchParams(query);if(before)params.set("before",before);
  const value=await artifactJson(fetcher,`${artifactBase(projectId)}?${params}`,{signal}) as Record<string,unknown>;
  const artifacts=parseArtifactList(value),next=value.nextCursor;
  if(artifacts.some(a=>a.projectId!==projectId||!Number.isFinite(Date.parse(a.createdAt)))||artifacts.length>50||!(next===null||typeof next==="string"&&next.length>0&&next.length<=1024)||next!==null&&next===before)throw new ArtifactClientError("invalid_response");
  return {artifacts,nextCursor:next as string|null};
}
/** A calendar cutoff uses the viewer's local midnight, sent as an exact UTC
 * instant; the server never guesses the browser's timezone. */
export function historyUntil(day:string):string{
  if(!day)return "";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return "";
  const [year,month,date]=day.split("-").map(Number),value=new Date(year!,month!-1,date!);
  if(value.getFullYear()!==year||value.getMonth()!==month!-1||value.getDate()!==date)return "";
  value.setDate(value.getDate()+1);return value.toISOString();
}
