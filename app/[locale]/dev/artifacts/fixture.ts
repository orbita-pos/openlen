"use client";
import {useEffect} from "react";
import type {ArtifactFetch,ArtifactSummary} from "@/components/workspace-v2/artifacts/client";
const createdAt="2026-10-19T10:00:00.000Z";
const fresh=[
  {id:"dashboard",title:"Ventas de Norte",kind:"dashboard",status:"running",currentRevision:2,lastReadyRevision:1},
  {id:"slides",title:"Norte · presentación del proyecto",kind:"slides",status:"queued",currentRevision:1,lastReadyRevision:null},
  {id:"image1",title:"Tu próximo pedido, en un solo lugar",kind:"image",status:"ready",currentRevision:1,lastReadyRevision:1},
  {id:"image2",title:"Promoción · segunda propuesta",kind:"image",status:"failed",currentRevision:1,lastReadyRevision:null},
  {id:"motion",title:"Así funciona Norte",kind:"motion",status:"running",currentRevision:1,lastReadyRevision:null},
  {id:"audio",title:"Narración de la presentación",kind:"audio",status:"draft",currentRevision:0,lastReadyRevision:null},
].map((a,index)=>({...a,projectId:"fixture",requestId:"demo-request",createdAt:new Date(Date.parse(createdAt)+index*1000).toISOString(),updatedAt:createdAt})) as ArtifactSummary[];
const kinds=["dashboard","slides","image","motion","audio"] as const;
const titles={dashboard:"Ventas por canal",slides:"Presentación para clientes",image:"Promoción de temporada",motion:"Recorrido del producto",audio:"Narración de bienvenida"};
const archive:ArtifactSummary[]=Array.from({length:240},(_,i)=>{
  const date=new Date(Date.UTC(2026,9,18-i*3)),kind=kinds[i%kinds.length]!;
  const status=i%13===0?"failed":i%17===0?"cancelled":i%19===0?"running":i%23===0?"draft":"ready";
  const ready=status==="ready"||status==="running";
  return {id:`archive-${i}`,projectId:"fixture",requestId:`archive-request-${Math.floor(i/5)}`,title:`${titles[kind]} · ${new Intl.DateTimeFormat("es",{month:"long",year:"numeric",timeZone:"UTC"}).format(date)}`,kind,status,currentRevision:status==="running"?2:1,lastReadyRevision:ready?1:null,createdAt:date.toISOString(),updatedAt:date.toISOString()};
});
const csv="mes,ventas\nEnero,18400\nFebrero,23800\nMarzo,31200\n";
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
export function createFixtureFetcher(offline:()=>boolean=()=>false):ArtifactFetch{
  const items=structuredClone([...fresh,...archive]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));let read="0";
  return async(url,init)=>{
    if(offline())throw Error("fixture_offline");
    const parsed=new URL(url,"http://fixture.local");
    if(url.includes("/events")){
      if(init?.method==="POST"){read=JSON.parse(String(init.body)).cursor;return json({cursor:read});}
      return json({events:parsed.searchParams.get("after")==="0"?[{cursor:"1",artifactId:"image1",type:"ready"}]:[],cursor:"1",lastRead:read});
    }
    const id=decodeURIComponent(parsed.pathname.split("/artifacts/")[1]?.split("/")[0]??"");
    const item=items.find(a=>a.id===id);
    if(url.endsWith("/preview"))return json({error:"preview_unavailable"},503);
    const image=item?.kind==="image",data=item?.kind==="dashboard"?csv:JSON.stringify({fixture:true,kind:item?.kind,title:item?.title},null,2);
    if(url.includes("/files/"))return image?fetch("/dev/len3-promo.png",init):new Response(data,{headers:{"content-type":item?.kind==="dashboard"?"text/csv":"application/json"}});
    if(item&&url.includes("/jobs/")){item.status="cancelled";return json({ok:true});}
    if(item){
      const chosen=parsed.searchParams.get("revision"),revision=chosen===null?item.currentRevision:Number(chosen);
      const output=image?{index:0,name:"norte-promo.png",format:"png",mime:"image/png",bytes:53106}:item.kind==="dashboard"?{index:0,name:"ventas.csv",format:"csv",mime:"text/csv",bytes:new TextEncoder().encode(data).length}:{index:0,name:`ejemplo-${item.kind}.json`,format:"json",mime:"application/json",bytes:new TextEncoder().encode(data).length};
      const outputs=item.lastReadyRevision===revision?[output]:[];
      return json({artifact:item,revision:{artifactId:item.id,revision,outputs,evidence:outputs.length?{valid:true}:null},jobs:[{id:"fixture-job",revision:item.currentRevision,status:item.status,createdAt}]});
    }
    if(parsed.searchParams.get("history")==="1"){
      const p=parsed.searchParams,q=(p.get("q")??"").toLocaleLowerCase(),kind=p.get("kind"),state=p.get("status"),until=p.get("until");
      const statuses:Record<string,string[]>={ready:["ready"],active:["queued","running","validating","storing"],failed:["failed","needs_attention"],draft:["draft"],cancelled:["cancelled"]};
      const filtered=items.filter(a=>(!q||a.title.toLocaleLowerCase().includes(q))&&(!kind||a.kind===kind)&&(!state||statuses[state]?.includes(a.status))&&(!until||a.createdAt<until));
      const start=Number((p.get("before")??"fixture_0").replace("fixture_","")),limit=Number(p.get("limit")??24),end=start+limit;
      return json({artifacts:filtered.slice(start,end),nextCursor:end<filtered.length?`fixture_${end}`:null,kinds});
    }
    return json({artifacts:items.slice(0,200),kinds});
  };
}
export function useFixtureTheme(dark:boolean){
  useEffect(()=>{
    const root=document.documentElement,previous=root.classList.contains("dark");root.classList.toggle("dark",dark);
    return()=>{root.classList.toggle("dark",previous);};
  },[dark]);
}
