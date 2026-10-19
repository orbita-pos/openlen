import {z} from "zod";
import {safeArtifactPath} from "../../state";
import {ArtifactError,type SealedArtifactInput} from "../../types";
import {compileArtifactHtml} from "../dashboard/compile";
import {SLIDES_CSP} from "../../html-policy";
import {CATALOGO_ACTUAL,catalogo} from "../../../apps/dependencias";
import {slideElementSchema,type SlideDeck} from "./manifest";
const id=z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const schema=z.object({version:z.literal(2),title:z.string().min(1).max(200),width:z.number().int().min(640).max(1920),height:z.number().int().min(360).max(1080),catalogo:z.string().default(CATALOGO_ACTUAL),datasetIds:z.array(z.string().min(1)).max(20).default([]),slides:z.array(z.object({id,source:z.string(),notes:z.string().max(10000).optional()}).strict()).min(1).max(50)}).strict();
export type HtmlSlideDeck=z.infer<typeof schema>;
export function parseHtmlSlideDeck(input:SealedArtifactInput):HtmlSlideDeck{
 try{
  const deck=schema.parse(JSON.parse(input.revision.files["deck.json"]??""));
  if(!catalogo(deck.catalogo)||new Set(deck.slides.map(s=>s.id)).size!==deck.slides.length||new Set(deck.slides.map(s=>s.source)).size!==deck.slides.length||deck.slides.some(s=>!safeArtifactPath(s.source)||!s.source.endsWith(".html")||!Object.hasOwn(input.revision.files,s.source)))throw new Error("invalid");
  if(new Set(deck.datasetIds).size!==deck.datasetIds.length||deck.datasetIds.some(id=>!input.datasets.some(d=>d.id===id)))throw new Error("missing dataset");
  return deck;
 }catch{throw new ArtifactError("invalid_html_slide_deck");}
}
const esc=(text:string)=>text.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
export async function compileHtmlSlideDeck(input:SealedArtifactInput,deck:HtmlSlideDeck){
 const slides=[];
 for(const s of deck.slides){
  const html=await compileArtifactHtml(input,s.source,deck.datasetIds.map(id=>input.datasets.find(d=>d.id===id)!),"",deck.catalogo);
  slides.push(`<iframe class="slide" data-slide-id="${s.id}" title="${esc(s.id)}" sandbox="allow-scripts" srcdoc="${esc(html)}"></iframe>`);
 }
 const html=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SLIDES_CSP}"><title>${esc(deck.title)}</title><style>html{overflow-x:hidden;scrollbar-width:none}html::-webkit-scrollbar{display:none}body{margin:0;background:#fff}.slide{display:block;border:0;width:${deck.width}px;height:${deck.height}px;break-after:page}.slide:last-child{break-after:auto}</style></head><body>${slides.join("\n")}</body></html>`;
 if(Buffer.byteLength(html)>8*1024*1024)throw new ArtifactError("html_slide_deck_too_large");
 return html;
}
const layoutSchema=z.object({slides:z.array(z.object({id,background:z.string().regex(/^[A-Fa-f0-9]{6}$/),elements:z.array(slideElementSchema).min(1).max(1500)}).strict()).min(1).max(50),assets:z.array(z.object({id:z.string().regex(/^layout-[A-Za-z0-9_-]{1,110}$/),mime:z.enum(["image/png","image/jpeg"]),base64:z.string().min(4).max(12*1024*1024).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).strict()).max(5000)}).strict();
/** Renderer output remains untrusted data, never evaluated in the worker. */
export function measuredSlideDeck(spec:HtmlSlideDeck,raw:unknown,input:SealedArtifactInput){
 try{
  const layout=layoutSchema.parse(raw);
  if(layout.slides.length!==spec.slides.length||layout.slides.some((s,i)=>s.id!==spec.slides[i]!.id)||new Set(layout.assets.map(a=>a.id)).size!==layout.assets.length)throw new Error("identity mismatch");
  let total=0;
  const assets=layout.assets.map(a=>{const bytes=new Uint8Array(Buffer.from(a.base64,"base64"));total+=bytes.length;if(total>8*1024*1024)throw new Error("raster limit");return {id:a.id,mime:a.mime,bytes};});
  const available=new Set(assets.map(a=>a.id));
  for(const s of layout.slides){
   if(new Set(s.elements.map(e=>e.id)).size!==s.elements.length)throw new Error("duplicate element");
   for(const e of s.elements){
    if(e.x+e.w>spec.width+.5||e.y+e.h>spec.height+.5||e.type==="chart"||e.type==="image"&&!available.has(e.assetId))throw new Error("invalid geometry/resource");
   }
  }
  const deck:SlideDeck={version:1,title:spec.title,width:spec.width,height:spec.height,fontFamily:"Arial",background:"FFFFFF",color:"111111",slides:layout.slides.map((s,i)=>({...s,notes:spec.slides[i]!.notes}))};
  return {deck,input:{...input,assets:[...input.assets,...assets]},rasterAssets:assets};
 }catch{throw new ArtifactError("invalid_slide_layout");}
}
