// @vitest-environment node
import {afterAll,expect,it} from "vitest";
import JSZip from "jszip";
import {compileHtmlSlideDeck,parseHtmlSlideDeck,measuredSlideDeck} from "./html-deck";
import {exportSlideDeckPptx} from "./pptx";
import {stopBundlerWorker} from "../../../apps/bundler/bundle-app";
import type {SealedArtifactInput} from "../../types";
afterAll(()=>stopBundlerWorker());
const descriptor={version:2,title:"Mi app",width:1280,height:720,slides:[{id:"cover",source:"slides/cover.html",notes:"Presentación"},{id:"data",source:"slides/data.html"}]};
const input={artifact:{kind:"slides"},revision:{files:{"deck.json":JSON.stringify(descriptor),"slides/cover.html":'<html><head><style>h1{color:red}</style></head><body><h1 id="title">Ventas</h1></body></html>',"slides/data.html":'<html><head><style>h1{color:blue}</style></head><body><h1>Resultados</h1></body></html>'}},assets:[],datasets:[]} as unknown as SealedArtifactInput;
it("compiles ordered independent HTML slides without leaking styles into neighbors",async()=>{
 const deck=parseHtmlSlideDeck(input);const html=await compileHtmlSlideDeck(input,deck);
 expect(html).toContain('data-slide-id="cover"');expect(html).toContain('data-slide-id="data"');
 expect(html.match(/sandbox="allow-scripts"/g)).toHaveLength(2);expect(html.match(/srcdoc=/g)).toHaveLength(2);
 expect(html.indexOf('data-slide-id="cover"')).toBeLessThan(html.indexOf('data-slide-id="data"'));
 const changed={...input,revision:{...input.revision,files:{...input.revision.files,"slides/cover.html":input.revision.files["slides/cover.html"]!.replace("Ventas","Nueva portada")}}};
 expect(parseHtmlSlideDeck(changed).slides[1]).toEqual(deck.slides[1]);
 expect((changed.revision.files as Readonly<Record<string,string>>)["slides/data.html"]).toBe(input.revision.files["slides/data.html"]);
});
it("rejects missing sources, duplicate identities and traversal",()=>{
 for(const slides of [[{id:"cover",source:"../secret.html"}],[{id:"cover",source:"missing.html"}],[descriptor.slides[0],descriptor.slides[0]]]){
  expect(()=>parseHtmlSlideDeck({...input,revision:{...input.revision,files:{...input.revision.files,"deck.json":JSON.stringify({...descriptor,slides})}}})).toThrow();
 }
});
it("validates measured geometry and exports real editable text, shapes and notes",async()=>{
 const spec=parseHtmlSlideDeck(input);
 const layout={slides:spec.slides.map(s=>({id:s.id,background:"FFFFFF",elements:[{id:"title-0",type:"text",x:64,y:50,w:500,h:70,text:s.id,fontSize:48,fontFamily:"Arial",bold:true,italic:true,color:"123456",align:"left"},{id:"card",type:"shape",x:64,y:170,w:500,h:260,shape:"rect",radius:16,fill:"EAF1FA",strokeWidth:0}]})),assets:[]};
 const measured=measuredSlideDeck(spec,layout,input);const pptx=await exportSlideDeckPptx(measured.deck,measured.input);
 const zip=await JSZip.loadAsync(pptx),xml=await zip.file("ppt/slides/slide1.xml")!.async("string");
 expect(xml).toContain('i="1"');expect(xml).toContain('name="cover/title-0"');expect(xml).toContain("roundRect");
 expect(await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string")).toContain("Presentación");
 layout.slides[0]!.elements[0]!.x=1270;
 expect(()=>measuredSlideDeck(spec,layout,input)).toThrow();
});
