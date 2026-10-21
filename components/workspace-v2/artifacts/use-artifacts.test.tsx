// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {useArtifacts} from "./use-artifacts";
import type {ArtifactFetch} from "./client";

(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const item={id:"a",projectId:"p",requestId:"r",title:"Dashboard",kind:"dashboard",status:"ready",currentRevision:2,lastReadyRevision:1,createdAt:"2026-10-19",updatedAt:"2026-10-19"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
let host:HTMLDivElement,root:Root,state:ReturnType<typeof useArtifacts>;
function Probe({project="p",fetcher}:{project?:string;fetcher:ArtifactFetch}){state=useArtifacts(project,fetcher);return null;}
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();});
async function render(fetcher:ArtifactFetch,project="p"){await act(async()=>{root.render(<Probe project={project} fetcher={fetcher}/>);});}

it("acknowledges only visible events, with full 64-bit precision across hidden rows",async()=>{
  let ack="";
  const fetcher:ArtifactFetch=async(url,init)=>{
    if(init?.method==="POST"){ack=JSON.parse(String(init.body)).cursor;return json({cursor:ack});}
    if(url.includes("/events"))return json({events:url.endsWith("after=0")?[{artifactId:"a",cursor:"9007199254740993",type:"ready"}]:[],cursor:"9007199254740994",lastRead:"9007199254740992"});
    return json({artifacts:[item]});
  };
  await render(fetcher);
  expect(state.unread).toEqual(["a"]);
  await act(async()=>{await state.acknowledge();});
  expect(ack).toBe("9007199254740993");
  expect(state.unread).toEqual([]);
});
it("stops on disabled features and removes cached private results after access loss",async()=>{
  vi.useFakeTimers();
  let status=200,calls=0;
  const fetcher:ArtifactFetch=async(url)=>{calls++;return status===200?json(url.includes("/events")?{events:[],cursor:"0",lastRead:"0"}:{artifacts:[item]}):json({error:status===404?"feature_disabled":"forbidden"},status);};
  await render(fetcher);
  expect(state.items).toHaveLength(1);
  status=403;
  await act(async()=>{await state.refresh();});
  expect(state.items).toHaveLength(0);
  await render(fetcher,"q");
  status=404;
  await act(async()=>{await state.refresh();});
  const before=calls;
  await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});
  expect(calls).toBe(before);
  expect(state.enabled).toBe(false);
});
it("ignores a late response from the previous project even when transport ignores abort",async()=>{
  let finish!:(r:Response)=>void;
  const fetcher:ArtifactFetch=async(url)=>url.includes("/p/")?new Promise(r=>{finish=r;}):json(url.includes("/events")?{events:[],cursor:"0",lastRead:"0"}:{artifacts:[]});
  await render(fetcher);
  await render(fetcher,"new-project");
  await act(async()=>{finish(json({artifacts:[item]}));});
  expect(state.items).toEqual([]);
});
it("keeps the previous ready result during a temporary connection failure",async()=>{
  let offline=false;
  const fetcher:ArtifactFetch=async(url)=>{if(offline)throw Error("offline");return json(url.includes("/events")?{events:[],cursor:"0",lastRead:"0"}:{artifacts:[item]});};
  await render(fetcher);offline=true;
  await act(async()=>{await state.refresh();});
  expect(state.disconnected).toBe(true);
  expect(state.items[0].lastReadyRevision).toBe(1);
});
it("does not hide every deliverable when a cancellation target has already disappeared",async()=>{
  const running={...item,status:"running"};
  const fetcher:ArtifactFetch=async(url,init)=>{
    if(init?.method==="POST")return json({error:"job_not_found"},404);
    if(url.endsWith("/artifacts/a"))return json({artifact:running,revision:{artifactId:"a",revision:2,outputs:[],evidence:null},jobs:[{id:"job",revision:2,status:"running",createdAt:"2026-10-19"}]});
    return json(url.includes("/events")?{events:[],cursor:"0",lastRead:"0"}:{artifacts:[running]});
  };
  await render(fetcher);
  await act(async()=>{await state.cancel(state.items[0]);});
  expect(state.enabled).toBe(true);
  expect(state.items).toHaveLength(1);
  expect(state.actionError).toBe(true);
});
it("does not restore private results from a late poll after an acknowledgement revokes access",async()=>{
  let lists=0,finish!:(r:Response)=>void;
  const fetcher:ArtifactFetch=async(url,init)=>{
    if(init?.method==="POST")return json({error:"forbidden"},403);
    if(url.includes("/events"))return json({events:[{artifactId:"a",cursor:"1",type:"ready"}],cursor:"1",lastRead:"0"});
    if(++lists===2)return new Promise(r=>{finish=r;});
    return json({artifacts:[item]});
  };
  await render(fetcher);
  let poll!:Promise<void>;
  await act(async()=>{poll=state.refresh();});
  await act(async()=>{await state.acknowledge();});
  await act(async()=>{finish(json({artifacts:[item]}));await poll;});
  expect(state.enabled).toBe(false);
  expect(state.items).toEqual([]);
});
it("marks a newer visible event read when it arrives during an older acknowledgement",async()=>{
  let cursor="1",finish!:(r:Response)=>void;
  const acknowledged:string[]=[];
  const fetcher:ArtifactFetch=async(url,init)=>{
    if(init?.method==="POST"){
      const sent=JSON.parse(String(init.body)).cursor;acknowledged.push(sent);
      return sent==="1"?new Promise(r=>{finish=r;}):json({cursor:sent});
    }
    return json(url.includes("/events")?{events:[{artifactId:"a",cursor,type:"ready"}],cursor,lastRead:"0"}:{artifacts:[item]});
  };
  await render(fetcher);let pending!:Promise<void>;
  await act(async()=>{pending=state.acknowledge();});
  cursor="2";await act(async()=>{await state.refresh();});
  await act(async()=>{finish(json({cursor:"1"}));await pending;});
  expect(acknowledged).toEqual(["1","2"]);
  expect(state.unread).toEqual([]);
});
it("does not poll while the page is hidden and catches up as soon as it is visible again",async()=>{
  vi.useFakeTimers();
  let state:DocumentVisibilityState="visible",calls=0;
  Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>state});
  try{
    const fetcher:ArtifactFetch=async(url)=>{calls++;return json(url.includes("/events")?{events:[],cursor:"0",lastRead:"0"}:{artifacts:[item]});};
    await render(fetcher);
    state="hidden";document.dispatchEvent(new Event("visibilitychange"));
    const before=calls;
    await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});
    expect(calls).toBe(before);
    state="visible";
    await act(async()=>{document.dispatchEvent(new Event("visibilitychange"));await vi.advanceTimersByTimeAsync(0);});
    expect(calls).toBeGreaterThan(before);
  }finally{delete (document as unknown as {visibilityState?:unknown}).visibilityState;}
});

it("asks nothing while there is no project to ask about (the workspace calls it before one opens)",async()=>{
  let calls=0;
  const fetcher:ArtifactFetch=async()=>{calls++;return json({artifacts:[]});};
  function Off(){state=useArtifacts(null,fetcher);return null;}
  await act(async()=>{root.render(<Off/>);});
  expect(calls).toBe(0);
  expect(state).toMatchObject({enabled:false,items:[],loading:false});
});
