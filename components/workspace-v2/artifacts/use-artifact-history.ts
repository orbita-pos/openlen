"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {artifactFetch,ArtifactClientError,type ArtifactFetch,type ArtifactSummary} from "./client";
import {fetchHistoryPage,historyQuery,type HistoryFilters} from "./history-client";

type State={key:string;items:ArtifactSummary[];nextCursor:string|null;loading:boolean;loadingMore:boolean;error:boolean;unavailable:boolean};
const initial=(key:string):State=>({key,items:[],nextCursor:null,loading:true,loadingMore:false,error:false,unavailable:false});
export function useArtifactHistory(projectId:string,filters:HistoryFilters,fetcher:ArtifactFetch=artifactFetch){
  const query=historyQuery(filters),key=JSON.stringify([projectId,query]);
  const [state,setState]=useState(()=>initial(key));
  const controls=useRef<{refresh:()=>Promise<void>;loadMore:()=>Promise<void>;remove:(id:string)=>void}|null>(null);
  useEffect(()=>{
    const abort=new AbortController();let disposed=false,stopped=false,busy=false;
    let items:ArtifactSummary[]=[],next:string|null=null;
    setState(initial(key));
    const patch=(changes:Partial<State>)=>{if(!disposed&&(!stopped||changes.unavailable))setState(s=>({...s,...changes}));};
    const revoke=(error:unknown)=>{
      if(error instanceof ArtifactClientError&&[401,403,404].includes(error.status)){
        stopped=true;abort.abort();items=[];next=null;
        patch({items:[],nextCursor:null,loading:false,loadingMore:false,error:false,unavailable:true});return true;
      }
      return false;
    };
    const request=async(reset:boolean)=>{
      if(disposed||stopped||busy||!reset&&!next)return;
      busy=true;
      if(reset){items=[];next=null;patch({items:[],nextCursor:null});}
      patch({loading:reset,loadingMore:!reset,error:false});
      let cursor=reset?null:next;
      const visited=new Set<string>();
      try{
        // Empty pages can represent authorized scanning across hidden records.
        for(let hop=0;hop<4;hop++){
          if(cursor){if(visited.has(cursor))throw new ArtifactClientError("invalid_response");visited.add(cursor);}
          const page=await fetchHistoryPage(fetcher,projectId,query,cursor,abort.signal);
          if(disposed||stopped)return;
          if(page.artifacts.length||!page.nextCursor||hop===3){
            items=[...new Map([...items,...page.artifacts].map(a=>[a.id,a])).values()];next=page.nextCursor;
            patch({items,nextCursor:next,loading:false,loadingMore:false,error:false});break;
          }
          cursor=page.nextCursor;
        }
      }catch(error){if(!disposed&&!revoke(error))patch({loading:false,loadingMore:false,error:true});}
      finally{busy=false;}
    };
    const current={refresh:()=>request(true),loadMore:()=>request(false),remove:(id:string)=>{items=items.filter(item=>item.id!==id);patch({items});}};controls.current=current;
    // Keep long-open history access checked without moving the reader back
    // to the first page whenever a tab regains focus.
    const checkAccess=async()=>{
      if(disposed||stopped||busy)return;
      const probe=new URLSearchParams(query);probe.set("limit","1");
      try{await fetchHistoryPage(fetcher,projectId,probe.toString(),null,abort.signal);}
      catch(error){if(!disposed)revoke(error);}
    };
    const focus=()=>{void checkAccess();};
    const timer=setInterval(focus,30000);window.addEventListener("focus",focus);
    void request(true);
    return()=>{disposed=true;abort.abort();clearInterval(timer);window.removeEventListener("focus",focus);if(controls.current===current)controls.current=null;};
  },[key,projectId,query,fetcher]);
  const refresh=useCallback(async()=>{await controls.current?.refresh();},[]);
  const loadMore=useCallback(async()=>{await controls.current?.loadMore();},[]);
  const remove=useCallback((id:string)=>{controls.current?.remove(id);},[]);
  return {...(state.key===key?state:initial(key)),refresh,loadMore,remove};
}
