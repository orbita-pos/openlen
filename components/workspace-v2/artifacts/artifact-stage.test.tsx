// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import messages from "@/messages/es/topbar.json";
import {ArtifactStage} from "./artifact-stage";
import type {ArtifactFetch,ArtifactSummary} from "./client";

(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const base={projectId:"p",requestId:"r",updatedAt:"2026-10-21"};
const deck:ArtifactSummary={...base,id:"deck",title:"Presentación de El Filo",kind:"slides",status:"ready",currentRevision:2,lastReadyRevision:2,createdAt:"2026-10-21T10:00:00Z"};
const video:ArtifactSummary={...base,id:"video",title:"Video de El Filo",kind:"motion",status:"running",currentRevision:3,lastReadyRevision:null,createdAt:"2026-10-21T11:00:00Z"};
const response=(data:unknown)=>new Response(JSON.stringify(data));
let host:HTMLDivElement,root:Root,calls:string[];
const fetcher:ArtifactFetch=async(url)=>{calls.push(url);return url.endsWith("/preview")?response({error:"preview_unavailable"}):response({artifact:deck,revision:{artifactId:"deck",revision:2,outputs:[{index:0,name:"deck.pdf",format:"pdf",mime:"application/pdf",bytes:10}],evidence:{valid:true}},jobs:[]});};
beforeEach(()=>{calls=[];host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();});
async function render(selectedId:string|null,onSelect:(id:string)=>void=()=>{}){
  await act(async()=>{root.render(<NextIntlClientProvider locale="es" messages={{topbar:messages}}><ArtifactStage projectId="p" items={[deck,video]} selectedId={selectedId} onSelect={onSelect} fetcher={fetcher} onAccessLost={()=>{}}/></NextIntlClientProvider>);});
}

it("opens the newest piece, and one still being made shows that it is being made instead of a viewer",async()=>{
  await render(null);
  expect(document.querySelector("[data-stage-piece][aria-current='true']")?.textContent).toContain("Video de El Filo");
  expect(document.body.textContent).toContain("Creando");
  expect(calls).toEqual([]);
});

it("shows the chosen piece in the page itself, not in a dialog, and lets you switch between pieces",async()=>{
  const chosen:string[]=[];
  await render("deck",(id)=>chosen.push(id));
  expect(calls.some((u)=>u.endsWith("/deck?revision=2"))).toBe(true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.querySelector('a[download]')?.textContent).toContain("Descargar");
  await act(async()=>{document.querySelector<HTMLElement>('[data-stage-piece="video"]')!.click();});
  expect(chosen).toEqual(["video"]);
});
