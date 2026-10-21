"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {activeStatus,artifactBase,artifactFetch,artifactJson,artifactUrl,ArtifactClientError,cursorAfter,inspectArtifact,parseArtifactList,type ArtifactFetch,type ArtifactSummary} from "./client";

type State={projectId:string|null;enabled:boolean|null;items:ArtifactSummary[];unread:string[];loading:boolean;disconnected:boolean;actionError:boolean;cancelling:string[]};
// No project yet (the workspace calls this before one opens): off, and nothing is asked.
const initial=(projectId:string|null):State=>({projectId,enabled:projectId?null:false,items:[],unread:[],loading:!!projectId,disconnected:false,actionError:false,cancelling:[]});
type Controller={refresh:()=>Promise<void>;acknowledge:()=>Promise<void>;cancel:(item:ArtifactSummary)=>Promise<void>};
type EventPage={events:{cursor:string;artifactId:string;type:string}[];cursor:string;lastRead:string};
function eventPage(value:unknown):EventPage{
  const p=value as EventPage;
  if(!p||typeof p.cursor!=="string"||typeof p.lastRead!=="string"||!Array.isArray(p.events))throw new ArtifactClientError("invalid_response");
  cursorAfter(p.cursor,p.lastRead);
  for(const event of p.events){
    if(typeof event.cursor!=="string"||typeof event.artifactId!=="string"||typeof event.type!=="string"||cursorAfter(event.cursor,p.cursor))throw new ArtifactClientError("invalid_response");
  }
  return p;
}

/** The scan cursor can cross hidden rows. Only a visible event may be marked read. */
export function useArtifacts(projectId:string|null,fetcher:ArtifactFetch=artifactFetch){
  const [state,setState]=useState(()=>initial(projectId));
  const controller=useRef<Controller|null>(null);
  useEffect(()=>{
    if(!projectId){setState(initial(null));controller.current=null;return;}
    const abort=new AbortController();
    let disposed=false,stopped=false,busy=false,acknowledging=false,timer:ReturnType<typeof setTimeout>|undefined;
    let scan="0",read="0",items:ArtifactSummary[]=[],failures=0;
    const seen=new Map<string,string>(),cancelling=new Set<string>();
    setState(initial(projectId));
    const unread=()=>items.filter(a=>seen.has(a.id)&&cursorAfter(seen.get(a.id)!,read)).map(a=>a.id);
    const patch=(changes:Partial<State>)=>{if(!disposed&&(!stopped||changes.enabled===false))setState(s=>({...s,...changes}));};
    const options={signal:abort.signal};
    const revoke=(error:unknown)=>{
      if(error instanceof ArtifactClientError&&(error.status===401||error.status===403||error.status===404)){
        stopped=true;abort.abort();items=[];seen.clear();clearTimeout(timer);
        patch({enabled:false,items:[],unread:[],loading:false,disconnected:false,cancelling:[]});return true;
      }
      return false;
    };
    const refresh=async()=>{
      if(disposed||stopped||busy)return;
      busy=true;clearTimeout(timer);
      try{
        const next=parseArtifactList(await artifactJson(fetcher,artifactBase(projectId),options));
        if(disposed||stopped)return;
        if(next.some(a=>a.projectId!==projectId))throw new ArtifactClientError("invalid_response");
        const visible=new Set(next.map(a=>a.id));
        let nextScan=scan,nextRead=read;
        const received=new Map(seen);
        // Bounded catch-up; the next poll resumes even if older pages are all hidden.
        for(let page=0;page<5;page++){
          const data=eventPage(await artifactJson(fetcher,`${artifactBase(projectId)}/events?after=${nextScan}`,options));
          if(disposed||stopped)return;
          if(cursorAfter(nextScan,data.cursor))throw new ArtifactClientError("invalid_response");
          if(cursorAfter(data.lastRead,nextRead))nextRead=data.lastRead;
          for(const e of data.events)if(visible.has(e.artifactId)&&cursorAfter(e.cursor,received.get(e.artifactId)??"0"))received.set(e.artifactId,e.cursor);
          if(!cursorAfter(data.cursor,nextScan))break;
          nextScan=data.cursor;
        }
        if(disposed||stopped)return;
        items=next;scan=nextScan;
        if(cursorAfter(nextRead,read))read=nextRead;
        seen.clear();for(const [id,cursor] of received)if(visible.has(id))seen.set(id,cursor);
        for(const id of cancelling)if(!items.some(a=>a.id===id&&activeStatus(a.status)))cancelling.delete(id);
        failures=0;
        patch({enabled:true,items,unread:unread(),loading:false,disconnected:false,cancelling:[...cancelling]});
      }catch(error){if(!disposed&&!revoke(error)){failures++;patch({loading:false,disconnected:true});}}
      finally{
        busy=false;
        // A hidden tab stops polling; becoming visible again catches up at once.
        if(!disposed&&!stopped)timer=setTimeout(()=>{if(document.visibilityState!=="hidden")void refresh();},failures?Math.min(30000,3000*2**Math.min(failures,4)):items.some(a=>activeStatus(a.status))?3000:10000);
      }
    };
    const acknowledge=async()=>{
      if(disposed||stopped||acknowledging)return;
      acknowledging=true;
      try{
        for(let page=0;page<5;page++){
          let cursor=read;
          for(const a of items){const c=seen.get(a.id);if(c&&cursorAfter(c,cursor))cursor=c;}
          if(!cursorAfter(cursor,read))break;
          const response=await artifactJson(fetcher,`${artifactBase(projectId)}/events`,{...options,method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({cursor})}) as {cursor:string};
          if(disposed||stopped)return;
          if(typeof response.cursor!=="string"||cursorAfter(cursor,response.cursor))throw new ArtifactClientError("invalid_response");
          if(cursorAfter(response.cursor,read))read=response.cursor;
          patch({unread:unread(),actionError:false});
        }
      }catch(error){if(!disposed&&!revoke(error))patch({actionError:true});}
      finally{acknowledging=false;}
    };
    const cancel=async(item:ArtifactSummary)=>{
      if(disposed||stopped||cancelling.has(item.id))return;
      cancelling.add(item.id);patch({cancelling:[...cancelling],actionError:false});
      try{
        const current=await inspectArtifact(fetcher,projectId,item.id,undefined,abort.signal);
        if(disposed)return;
        // Never cancel a replacement revision that the person has not seen.
        if(current.artifact.currentRevision!==item.currentRevision)throw new ArtifactClientError("revision_conflict");
        const job=current.jobs.filter(j=>j.revision===item.currentRevision&&activeStatus(j.status)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
        if(!job)throw new ArtifactClientError("job_not_found");
        await artifactJson(fetcher,`${artifactUrl(projectId,item.id)}/jobs/${encodeURIComponent(job.id)}`,{...options,method:"POST"});
        if(disposed)return;
        await refresh();
      }catch(error){
        cancelling.delete(item.id);
        // A vanished job/revision is a stale action, not lost project access.
        const missing=error instanceof ArtifactClientError&&error.status===404&&error.code!=="feature_disabled";
        if(!disposed&&(missing||!revoke(error)))patch({actionError:true,cancelling:[...cancelling]});
      }
    };
    const current={refresh,acknowledge,cancel};controller.current=current;
    const reconnect=()=>{void refresh();};window.addEventListener("online",reconnect);
    const visible=()=>{if(document.visibilityState!=="hidden")void refresh();};document.addEventListener("visibilitychange",visible);
    void refresh();
    return()=>{disposed=true;abort.abort();clearTimeout(timer);window.removeEventListener("online",reconnect);document.removeEventListener("visibilitychange",visible);if(controller.current===current)controller.current=null;};
  },[projectId,fetcher]);
  const refresh=useCallback(async()=>{await controller.current?.refresh();},[]);
  const acknowledge=useCallback(async()=>{await controller.current?.acknowledge();},[]);
  const cancel=useCallback(async(item:ArtifactSummary)=>{await controller.current?.cancel(item);},[]);
  return {...(state.projectId===projectId?state:initial(projectId)),refresh,acknowledge,cancel};
}
