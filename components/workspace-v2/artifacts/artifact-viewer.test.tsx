// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import messages from "@/messages/es/topbar.json";
import {ArtifactViewer} from "./artifact-viewer";
import type {ArtifactFetch,ArtifactSummary} from "./client";

(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const item:ArtifactSummary={id:"a",projectId:"p",requestId:"r",title:"Dashboard",kind:"dashboard",status:"ready",currentRevision:1,lastReadyRevision:1,createdAt:"2026-10-19",updatedAt:"2026-10-19"};
const response=(data:unknown)=>new Response(JSON.stringify(data));
let host:HTMLDivElement,root:Root;
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function render(fetcher:ArtifactFetch,onAccessLost=()=>{},selectedItem=item){await act(async()=>{root.render(<NextIntlClientProvider locale="es" messages={{topbar:messages}}><ArtifactViewer projectId="p" item={selectedItem} revision={1} fetcher={fetcher} onClose={()=>{}} onAccessLost={onAccessLost}/></NextIntlClientProvider>);});}
const inspection={artifact:item,revision:{artifactId:"a",revision:1,outputs:[{index:0,name:"dashboard.html",mime:"text/html",format:"html",bytes:100}],evidence:{valid:true}},jobs:[]};
it("embeds only a private grant with an opaque sandbox and never source HTML",async()=>{
  await render(async(url)=>response(url.endsWith("/preview")?{url:`https://preview.openlen.test/grant/${"a".repeat(43)}`,view:{id:"view",artifactId:"a",revision:1,liveDatasetIds:[]}}:inspection));
  const frame=document.querySelector("iframe")!;
  expect(frame).not.toBeNull();
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.hasAttribute("srcdoc")).toBe(false);
  expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
});
it.each(["dashboard","slides"] as const)("prefers interactive HTML over generated PNG thumbnails for %s",async(kind)=>{
  const fetcher=vi.fn(async(url:string)=>response(url.endsWith("/preview")?{url:`https://preview.openlen.test/grant/${"a".repeat(43)}`,view:{id:"view",artifactId:"a",revision:1,liveDatasetIds:[]}}:{...inspection,artifact:{...item,kind},revision:{...inspection.revision,outputs:[...inspection.revision.outputs,{index:1,name:"page-001.png",mime:"image/png",format:"png",bytes:3},{index:2,name:"page-002.png",mime:"image/png",format:"png",bytes:3}]}}));
  await render(fetcher,undefined,{...item,kind});
  expect(document.querySelector("iframe")).not.toBeNull();
  expect(fetcher.mock.calls.some(([url])=>url.includes("/files/"))).toBe(false);
});
it("plays the MP4 instead of a poster when motion exports include HTML and PNG",async()=>{
  await render(async()=>response({...inspection,artifact:{...item,kind:"motion"},revision:{...inspection.revision,outputs:[...inspection.revision.outputs,{index:1,name:"video.mp4",mime:"video/mp4",format:"mp4",bytes:100},{index:2,name:"poster.png",mime:"image/png",format:"png",bytes:3}]}}),undefined,{...item,kind:"motion"});
  expect(document.querySelector("video")?.getAttribute("src")).toContain("/files/1?revision=1");
  expect(document.querySelector("img")).toBeNull();
});
it("clears the viewer on access loss and makes no preview call",async()=>{
  const onAccessLost=vi.fn();
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:"forbidden"}),{status:403}));
  await render(fetcher,onAccessLost);
  expect(onAccessLost).toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(document.querySelector("iframe")).toBeNull();
  expect(document.querySelector('a[download]')).toBeNull();
});
it("rejects an authenticated-origin HTML grant but retains private downloads",async()=>{
  await render(async(url)=>response(url.endsWith("/preview")?{url:`${window.location.origin}/grant/${"a".repeat(43)}`,view:{id:"view",artifactId:"a",revision:1,liveDatasetIds:[]}}:inspection));
  expect(document.querySelector("iframe")).toBeNull();
  expect(document.querySelector('a[download]')).not.toBeNull();
});
it("loads authorized image bytes and revokes its object URL when closed",async()=>{
  const create=vi.fn(()=>"blob:authorized-image"),revoke=vi.fn();
  Object.defineProperty(URL,"createObjectURL",{configurable:true,value:create});
  Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:revoke});
  const fetcher:ArtifactFetch=async(url)=>url.includes("/files/")?new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"image/png"}}):response({...inspection,revision:{...inspection.revision,outputs:[{index:0,name:"promo.png",mime:"image/png",format:"png",bytes:3}]}});
  await render(fetcher);
  expect(create).toHaveBeenCalledTimes(1);
  expect(document.querySelector("img")?.getAttribute("src")).toBe("blob:authorized-image");
  act(()=>root.unmount());root=createRoot(host);
  expect(revoke).toHaveBeenCalledWith("blob:authorized-image");
});
it("handles revoked access at download time instead of leaving a stale result visible",async()=>{
  const onAccessLost=vi.fn();
  await render(async(url)=>url.includes("/files/")?new Response("",{status:403}):response(url.endsWith("/preview")?{error:"preview_unavailable"}:inspection),onAccessLost);
  await act(async()=>{document.querySelector<HTMLAnchorElement>('a[download]')!.click();});
  expect(onAccessLost).toHaveBeenCalled();
  expect(document.querySelector('a[download]')).toBeNull();
});
it("presents download-only formats as available files rather than a failed preview",async()=>{
  await render(async()=>response({...inspection,revision:{...inspection.revision,outputs:[{index:0,name:"ventas.csv",mime:"text/csv",format:"csv",bytes:2048}]}}));
  expect(document.body.textContent).toContain("Listo para descargar");
  expect(document.body.textContent).toContain("ventas.csv");
  expect(document.body.textContent).toContain("2 KB");
  expect(document.body.textContent).not.toContain("La vista previa no está disponible");
});
it("offers a metadata-only reload when nothing loaded, without promising unavailable downloads",async()=>{
  let unavailable=true;
  const urls:string[]=[];
  await render(async(url)=>{urls.push(url);return unavailable?new Response(JSON.stringify({error:"artifact_unavailable"}),{status:503}):response({...inspection,revision:{...inspection.revision,outputs:[{index:0,name:"ventas.csv",mime:"text/csv",format:"csv",bytes:10}]}});});
  expect(document.body.textContent).toContain("No pudimos cargar este entregable");
  expect(document.querySelector('a[download]')).toBeNull();
  unavailable=false;
  const retry=[...document.querySelectorAll("button")].find(b=>b.textContent?.includes("Volver a cargar"))!;
  await act(async()=>{retry.click();});
  expect(document.querySelector('a[download]')?.getAttribute("href")).toContain("?revision=1");
  expect(urls.every(url=>url.endsWith("/a?revision=1"))).toBe(true);
});

it("shows the piece inside the page instead of a dialog when the workspace center hosts it",async()=>{
  await act(async()=>{root.render(<NextIntlClientProvider locale="es" messages={{topbar:messages}}><ArtifactViewer inline projectId="p" item={item} revision={1} fetcher={async(url)=>response(url.endsWith("/preview")?{url:`https://preview.openlen.test/grant/${"a".repeat(43)}`,view:{id:"view",artifactId:"a",revision:1,liveDatasetIds:[]}}:inspection)} onClose={()=>{}} onAccessLost={()=>{}}/></NextIntlClientProvider>);});
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.querySelector("iframe")).not.toBeNull();
  expect(document.body.textContent).toContain("Dashboard");
});

it("falls back to the slide pictures when the live preview is unavailable, one at a time",async()=>{
  const png=new Uint8Array([137,80,78,71]);
  const slides={...item,kind:"slides" as const,title:"Presentación"};
  const outputs=[{index:0,name:"deck.html",mime:"text/html",format:"html",bytes:100},{index:1,name:"deck.pdf",mime:"application/pdf",format:"pdf",bytes:9},{index:2,name:"slide-002.png",mime:"image/png",format:"png",bytes:4},{index:3,name:"slide-001.png",mime:"image/png",format:"png",bytes:4}];
  const fetched:string[]=[];
  const fetcher:ArtifactFetch=async(url)=>{
    if(url.endsWith("/preview"))return new Response(JSON.stringify({error:"preview_unavailable"}),{status:503});
    if(url.includes("/files/")){fetched.push(url);return new Response(png,{headers:{"content-type":"image/png"}});}
    return response({...inspection,artifact:slides,revision:{...inspection.revision,outputs}});
  };
  Object.defineProperty(URL,"createObjectURL",{configurable:true,value:()=>"blob:slide"});
  Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:()=>{}});
  const settle=async(done:()=>boolean)=>{for(let i=0;i<50&&!done();i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});};
  await render(fetcher,undefined,slides);
  await settle(()=>!!document.querySelector("img"));
  expect(document.querySelector("img")?.getAttribute("src")).toBe("blob:slide");
  expect(fetched.at(-1)).toContain("/files/3?");
  expect(document.body.textContent).toContain("1 / 2");
  await act(async()=>{document.querySelector<HTMLButtonElement>('[aria-label="Siguiente"]')!.click();});
  await settle(()=>fetched.at(-1)!.includes("/files/2?")&&!!document.querySelector("img"));
  expect(fetched.at(-1)).toContain("/files/2?");
  expect(document.body.textContent).toContain("2 / 2");
});


it("fits the saved dashboard viewport in both dimensions on resize without upscaling",async()=>{
  let resize:ResizeObserverCallback=()=>{};const disconnect=vi.fn();
  vi.stubGlobal("ResizeObserver",class {constructor(callback:ResizeObserverCallback){resize=callback;}observe(){}disconnect=disconnect;});
  await render(async(url)=>response(url.endsWith("/preview")?{url:`https://preview.openlen.test/grant/${"a".repeat(43)}`,frame:{width:1280,height:720},view:{id:"view",artifactId:"a",revision:1,liveDatasetIds:[]}}:inspection));
  const frame=document.querySelector("iframe")!;
  const fit=async(width:number,height:number)=>{await act(async()=>resize([{contentRect:{width,height}} as ResizeObserverEntry],{} as ResizeObserver));};
  await fit(640,500);
  expect(frame.style.width).toBe("1280px");expect(frame.style.height).toBe("720px");expect(frame.style.transform).toBe("scale(0.5)");
  await fit(1000,180);expect(frame.style.transform).toBe("scale(0.25)");
  await fit(2000,1200);expect(frame.style.transform).toBe("scale(1)");
  act(()=>root.unmount());root=createRoot(host);expect(disconnect).toHaveBeenCalled();vi.unstubAllGlobals();
});
it.each([{width:999999,height:720},{width:1280,height:0},{width:"1280",height:720}])("ignores invalid preview dimensions: %j",async(frame)=>{
  await render(async(url)=>response(url.endsWith("/preview")?{url:`https://preview.openlen.test/grant/${"a".repeat(43)}`,frame,view:{id:"view",artifactId:"a",revision:1,liveDatasetIds:[]}}:inspection));
  expect(document.querySelector("iframe")!.style.width).toBe("");
});
