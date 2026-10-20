// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import messages from "@/messages/es/topbar.json";
import {ArtifactTray} from "./artifact-tray";
import type {ArtifactFetch} from "./client";
import type {AnchorHTMLAttributes} from "react";
vi.mock("@/i18n/navigation",()=>({Link:(props:AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}/>}));

(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const base={projectId:"p",requestId:"r",createdAt:"2026-10-19",updatedAt:"2026-10-19",currentRevision:2,lastReadyRevision:1};
const items=[{...base,id:"dashboard",title:"Ventas",kind:"dashboard",status:"running"},{...base,id:"image1",title:"Promoción 1",kind:"image",status:"ready"},{...base,id:"image2",title:"Promoción 2",kind:"image",status:"failed",lastReadyRevision:null}];
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
let host:HTMLDivElement,root:Root,calls:{url:string;method:string}[];
const fetcher:ArtifactFetch=async(url,init)=>{
  calls.push({url,method:init?.method??"GET"});
  if(url.endsWith("/preview"))return response({error:"preview_unavailable"},503);
  if(url.includes("/events"))return response({events:[],cursor:"0",lastRead:"0"});
  if(url.includes("?revision=1"))return response({artifact:items[0],revision:{artifactId:"dashboard",revision:1,outputs:[{index:0,name:"dashboard.html",format:"html",mime:"text/html",bytes:100}],evidence:{valid:true}},jobs:[]});
  return response({artifacts:items});
};
beforeEach(()=>{calls=[];host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();});
async function render(readOnly=false){await act(async()=>{root.render(<NextIntlClientProvider locale="es" messages={{topbar:messages}}><ArtifactTray projectId="p" readOnly={readOnly} fetcher={fetcher}/></NextIntlClientProvider>);});}
async function click(el:Element|null){expect(el).not.toBeNull();await act(async()=>{(el as HTMLElement).click();});}

it("keeps two images independent and opens the pinned last ready dashboard during a revision",async()=>{
  await render();
  await click(document.querySelector('[aria-label="Entregables"]'));
  expect(document.querySelectorAll("[data-artifact]")).toHaveLength(3);
  expect(document.querySelector('[data-artifact="image1"]')?.textContent).toContain("Listo");
  expect(document.querySelector('[data-artifact="image2"]')?.textContent).toContain("No se pudo completar");
  await click(document.querySelector('[data-artifact="dashboard"] [data-artifact-open]'));
  expect(calls.some(c=>c.url.endsWith("/dashboard?revision=1"))).toBe(true);
  expect(document.querySelector('a[download]')?.getAttribute("href")).toBe("/api/projects/p/artifacts/dashboard/files/0?revision=1");
  expect(document.body.textContent).toContain("La vista previa no está disponible");
  expect(document.querySelector("iframe")).toBeNull();
});
it("readers can view results without cancellation controls, and Escape returns focus",async()=>{
  await render(true);
  const trigger=document.querySelector<HTMLButtonElement>('[aria-label="Entregables"]')!;trigger.focus();
  await click(trigger);
  expect(document.querySelector('[data-artifact-cancel]')).toBeNull();
  await act(async()=>{document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));});
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});
it("links to the complete project history from the notification panel",async()=>{
  await render();await click(document.querySelector('[aria-label="Entregables"]'));
  const link=[...document.querySelectorAll("a")].find(a=>a.textContent?.includes("Ver todos los entregables"));
  expect(link?.getAttribute("href")).toContain("/projects/p/artifacts");
});

it("asks nothing and shows nothing when deliverables are off on this server",async()=>{
  await act(async()=>{root.render(<NextIntlClientProvider locale="es" messages={{topbar:messages}}><ArtifactTray projectId="p" enabled={false} fetcher={fetcher}/></NextIntlClientProvider>);});
  expect(calls).toEqual([]);
  expect(document.querySelector('[aria-label="Entregables"]')).toBeNull();
});
