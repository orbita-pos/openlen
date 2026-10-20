// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {AnchorHTMLAttributes} from "react";
import messages from "@/messages/es/topbar.json";
import {ArtifactLibrary} from "./artifact-library";
import type {ArtifactFetch} from "./client";
vi.mock("@/i18n/navigation",()=>({Link:(props:AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}/>}));
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const item=(id:string)=>({id,projectId:"p",requestId:"r",title:"Presentación "+id,kind:"slides",status:"running",currentRevision:2,lastReadyRevision:1,createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"});
const json=(v:unknown)=>new Response(JSON.stringify(v));
let root:Root,host:HTMLDivElement;
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function render(fetcher:ArtifactFetch){await act(async()=>{root.render(<NextIntlClientProvider locale="es" messages={{topbar:messages}}><ArtifactLibrary projectId="p" projectName="Norte" readOnly fetcher={fetcher}/></NextIntlClientProvider>);});}
async function click(el:Element|null){expect(el).not.toBeNull();await act(async()=>{(el as HTMLElement).click();});}
it("loads old pages and opens their pinned ready revision while preserving reader controls",async()=>{
  const calls:string[]=[];
  await render(async(url)=>{
    calls.push(url);
    if(url.includes("/old?revision=1"))return json({artifact:item("old"),revision:{artifactId:"old",revision:1,outputs:[],evidence:{valid:true}},jobs:[]});
    return json({artifacts:[item(url.includes("before=")?"old":"new")],nextCursor:url.includes("before=")?null:"older"});
  });
  await click([...document.querySelectorAll("button")].find(b=>b.textContent?.includes("Cargar anteriores"))!);
  expect(document.querySelectorAll("[data-history-item]")).toHaveLength(2);
  expect(document.querySelector("[data-artifact-cancel]")).toBeNull();
  await click(document.querySelector('[data-history-item="old"] [data-history-open]'));
  expect(calls.some(url=>url.endsWith("/old?revision=1"))).toBe(true);
});
it("sends type filtering to the server and hides results that belonged to the previous filter",async()=>{
  const calls:string[]=[];
  await render(async(url)=>{calls.push(url);return json({artifacts:url.includes("kind=image")?[]:[item("new")],nextCursor:null});});
  await click(document.querySelector('[data-history-kind="image"]'));
  expect(calls.some(url=>url.includes("kind=image"))).toBe(true);
  expect(document.querySelectorAll("[data-history-item]")).toHaveLength(0);
  expect(document.body.textContent).toContain("No encontramos entregables");
});

it("closes an opened delivery and removes its row when its access changes while project history stays available",async()=>{
  let denied=false;
  await render(async(url)=>{
    if(url.includes("/new?revision=1"))return denied?new Response(JSON.stringify({error:"not_found"}),{status:404}):json({artifact:item("new"),revision:{artifactId:"new",revision:1,outputs:[],evidence:{valid:true}},jobs:[]});
    // The project and history endpoint still allow this reader.
    return json({artifacts:[item("new")],nextCursor:null});
  });
  await click(document.querySelector('[data-history-open]'));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  denied=true;await act(async()=>{window.dispatchEvent(new Event("focus"));});
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.querySelector('[data-history-item="new"]')).toBeNull();
});
