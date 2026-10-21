// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach,beforeEach,expect,it} from "vitest";
import messages from "@/messages/es/topbar.json";
import {ArtifactTurnCards} from "./artifact-turn-cards";
import {WorkspaceArtifactsContext} from "./workspace-artifacts";
import type {ArtifactSummary} from "./client";

(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const DECK="11111111-1111-4111-8111-111111111111",VIDEO="22222222-2222-4222-8222-222222222222";
const base={projectId:"p",requestId:"r",createdAt:"2026-10-21",updatedAt:"2026-10-21"};
const deck:ArtifactSummary={...base,id:DECK,title:"Presentación de El Filo",kind:"slides",status:"ready",currentRevision:2,lastReadyRevision:2};
const video:ArtifactSummary={...base,id:VIDEO,title:"Video de El Filo",kind:"motion",status:"running",currentRevision:3,lastReadyRevision:null};
const actions=[
  {tool:"create_artifact",status:"done" as const,summary:"draft",valores:JSON.stringify({artifactId:DECK,revision:0})},
  {tool:"create_artifact",status:"done" as const,summary:"draft",valores:JSON.stringify({artifactId:VIDEO,revision:0})},
  {tool:"render_artifact",status:"done" as const,summary:"queued",valores:JSON.stringify({artifactId:DECK,revision:2,jobId:"j"})},
];
let host:HTMLDivElement,root:Root;
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});

it("gives each piece of the turn a card with its live status, and opens the ready ones",async()=>{
  const opened:string[]=[];
  await act(async()=>{root.render(<NextIntlClientProvider locale="es" messages={{topbar:messages}}>
    <WorkspaceArtifactsContext.Provider value={{items:[deck,video],open:(item)=>opened.push(item.id)}}><ArtifactTurnCards actions={actions}/></WorkspaceArtifactsContext.Provider>
  </NextIntlClientProvider>);});
  const cards=document.querySelectorAll("[data-turn-artifact]");
  expect([...cards].map((c)=>c.getAttribute("data-turn-artifact"))).toEqual([DECK,VIDEO]);
  expect(cards[0]!.textContent).toContain("Presentación de El Filo");
  expect(cards[0]!.textContent).toContain("Listo");
  expect(cards[1]!.textContent).toContain("Creando");
  expect(cards[1]!.querySelector("button")).toBeNull();
  await act(async()=>{cards[0]!.querySelector("button")!.click();});
  expect(opened).toEqual([DECK]);
});

it("shows nothing where deliverables are off, or for a turn that made none",async()=>{
  await act(async()=>{root.render(<NextIntlClientProvider locale="es" messages={{topbar:messages}}><ArtifactTurnCards actions={actions}/></NextIntlClientProvider>);});
  expect(host.innerHTML).toBe("");
  await act(async()=>{root.render(<NextIntlClientProvider locale="es" messages={{topbar:messages}}>
    <WorkspaceArtifactsContext.Provider value={{items:[deck],open:()=>{}}}><ArtifactTurnCards actions={[{tool:"Read",status:"done",summary:""}]}/></WorkspaceArtifactsContext.Provider>
  </NextIntlClientProvider>);});
  expect(host.innerHTML).toBe("");
});
