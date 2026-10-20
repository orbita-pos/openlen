// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {useArtifactHistory} from "./use-artifact-history";
import type {ArtifactFetch} from "./client";
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const item=(id:string)=>({id,projectId:"p",requestId:"r",title:id,kind:"image",status:"draft",currentRevision:0,lastReadyRevision:null,createdAt:"2026-10-19T00:00:00.000Z",updatedAt:"2026-10-19T00:00:00.000Z"});
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
let root:Root,host:HTMLDivElement,state:ReturnType<typeof useArtifactHistory>;
function Probe({fetcher,q="",projectId="p"}:{fetcher:ArtifactFetch;q?:string;projectId?:string}){state=useArtifactHistory(projectId,{q},fetcher);return null;}
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();});
async function render(fetcher:ArtifactFetch,q=""){await act(async()=>{root.render(<Probe fetcher={fetcher} q={q}/>);});}
it("retains earlier pages when loading more fails and retries without consuming the cursor",async()=>{
  let fail=true;
  const fetcher:ArtifactFetch=async(url)=>{
    if(url.includes("before=")){if(fail)throw Error("offline");return json({artifacts:[item("old")],nextCursor:null});}
    return json({artifacts:[item("new")],nextCursor:"older-cursor"});
  };
  await render(fetcher);await act(async()=>{await state.loadMore();});
  expect(state.items.map(a=>a.id)).toEqual(["new"]);expect(state.error).toBe(true);
  fail=false;await act(async()=>{await state.loadMore();});
  expect(state.items.map(a=>a.id)).toEqual(["new","old"]);expect(state.nextCursor).toBeNull();
});
it("discards a slow result after the search changes",async()=>{
  let finish!:(r:Response)=>void;
  const fetcher:ArtifactFetch=async(url)=>url.includes("q=old")?new Promise(r=>{finish=r;}):json({artifacts:[item("matched")],nextCursor:null});
  await render(fetcher,"old");await render(fetcher,"new");
  await act(async()=>{finish(json({artifacts:[item("stale")],nextCursor:null}));});
  expect(state.items.map(a=>a.id)).toEqual(["matched"]);
});
it("skips empty hidden batches and clears cached results after access revocation",async()=>{
  let denied=false;
  const fetcher:ArtifactFetch=async(url)=>denied?json({error:"project_not_found"},404):url.includes("before=")?json({artifacts:[item("visible")],nextCursor:null}):json({artifacts:[],nextCursor:"hidden-cursor"});
  await render(fetcher);expect(state.items).toHaveLength(1);
  denied=true;await act(async()=>{await state.refresh();});
  expect(state.items).toEqual([]);expect(state.unavailable).toBe(true);
});

it("discards the previous project's late response",async()=>{
  let finish!:(r:Response)=>void;
  const fetcher:ArtifactFetch=async(url)=>url.includes("/p/")?new Promise(r=>{finish=r;}):json({artifacts:[{...item("next"),projectId:"other"}],nextCursor:null});
  await render(fetcher);
  await act(async()=>{root.render(<Probe fetcher={fetcher} projectId="other"/>);});
  await act(async()=>{finish(json({artifacts:[item("stale")],nextCursor:null}));});
  expect(state.items.map(a=>a.id)).toEqual(["next"]);
});
it("focus revocation wins over an in-flight page response",async()=>{
  let probe!:(r:Response)=>void,more!:(r:Response)=>void;
  const fetcher:ArtifactFetch=async(url)=>url.includes("before=")?new Promise(r=>{more=r;}):new URL("https://fixture.test"+url).searchParams.get("limit")==="1"?new Promise(r=>{probe=r;}):json({artifacts:[item("visible")],nextCursor:"older"});
  await render(fetcher);
  await act(async()=>{window.dispatchEvent(new Event("focus"));});
  let pending!:Promise<void>;await act(async()=>{pending=state.loadMore();});
  await act(async()=>{probe(json({error:"project_not_found"},404));});
  await act(async()=>{more(json({artifacts:[item("stale")],nextCursor:null}));await pending;});
  expect(state.unavailable).toBe(true);expect(state.items).toEqual([]);
});
