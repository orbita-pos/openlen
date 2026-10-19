import {createServer} from "node:http";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import path from "node:path";
import {buildDashboard} from "../lib/artifacts/adapters/dashboard/compile";
import {parseHtmlSlideDeck,compileHtmlSlideDeck,measuredSlideDeck} from "../lib/artifacts/adapters/slides/html-deck";
import {exportSlideDeckPptx,validateSlideDeckPptx} from "../lib/artifacts/adapters/slides/pptx";
import type {SealedArtifactInput} from "../lib/artifacts/types";
async function main(){
 const dir=path.resolve(process.argv[2]??"");if(!process.argv[2])throw new Error("Pass an output directory");await mkdir(dir,{recursive:true});
 const dashboardInput={artifact:{kind:"dashboard"},revision:{files:{"dashboard.json":JSON.stringify({entry:"index.html",catalogo:"2026-11",width:1280,height:720,datasetIds:["sales"]}),"index.html":'<html lang="es"><head></head><body><div id="root"></div><script type="module" src="main.tsx"></script></body></html>',"theme.css":'body{margin:0;background:#101c2a;color:#eef6ff;font-family:Arial}#root{padding:48px}select{font:inherit;padding:10px}h1{font-size:40px}#total{@apply text-5xl font-bold} .recharts-wrapper{margin-top:30px}',"main.tsx":`import React,{useState,useEffect} from "react";import {createRoot} from "react-dom/client";import {BarChart,Bar,XAxis,YAxis,CartesianGrid,Tooltip} from "recharts";import "./theme.css";let done;window.lenReady=new Promise(resolve=>done=resolve);function App(){const [zone,set]=useState('Todas');const rows=window.lenData.datasets[0].rows.filter(r=>zone==='Todas'||r[0]===zone).map(r=>({zone:r[0],sales:r[1]}));useEffect(()=>{done()},[]);return <><p>PRUEBA TÉCNICA · DATOS SINTÉTICOS</p><h1>Ventas por región</h1><label>Región <select id="zone" value={zone} onChange={e=>set(e.target.value)}><option>Todas</option><option>Norte</option><option>Sur</option></select></label><p id="total">{rows.reduce((sum,r)=>sum+r.sales,0)}</p><BarChart width={1050} height={350} data={rows}><CartesianGrid stroke="#344052" vertical={false}/><XAxis dataKey="zone" stroke="#eef6ff"/><YAxis stroke="#eef6ff"/><Tooltip/><Bar dataKey="sales" fill="#85d8be" isAnimationActive={false}/></BarChart></>};createRoot(document.getElementById('root')).render(<App/>);`}},datasets:[{id:"sales",mode:"scenario",environment:null,columns:["Zona","Ventas"],rows:[["Norte",120],["Sur",80]],source:"scenario",capturedAt:new Date().toISOString(),truncated:false}],assets:[]} as unknown as SealedArtifactInput;
 const dashboard=(await buildDashboard(dashboardInput)).html;
 const head='<style>*{box-sizing:border-box}body{margin:0;width:1280px;height:720px;padding:64px;font-family:Arial;color:#162b40;background:#f3f2eb}h1{font-size:64px;line-height:1.08;margin:24px 0}h2{font-size:42px;margin:0 0 24px}p{font-size:24px;line-height:1.4;margin:16px 0}.grid{display:grid;grid-template-columns:1.2fr 1fr;gap:52px}.card{background:#dae8df;border:2px solid #bed4c7;border-radius:24px;padding:36px}.eyebrow{font-size:16px;font-weight:bold;color:#3c6c5e;letter-spacing:2px}</style>';
 const spec={version:2,title:"OpenLen · prueba de composición HTML",width:1280,height:720,slides:[{id:"cover",source:"slides/cover.html",notes:"Fuente HTML editable; texto y tarjetas nativos en PowerPoint."},{id:"details",source:"slides/details.html",notes:"Segunda diapositiva independiente."}]};
 const input={artifact:{kind:"slides"},revision:{files:{"deck.json":JSON.stringify(spec),"slides/cover.html":`<html><head>${head}</head><body><div class="eyebrow">OPENLEN · PRUEBA TÉCNICA</div><h1>Tu app, lista<br>para presentarla.</h1><div class="grid"><div><p>Un solo proyecto, varios entregables.</p><p>Texto con <strong>énfasis editable</strong> y <em>otro estilo.</em></p></div><div class="card"><h2>De la idea al equipo</h2><p>Slides con CSS grid, tipografía y componentes.</p><div data-len-raster style="width:320px;height:70px;background:linear-gradient(90deg,#3c6c5e,#85d8be);border-radius:12px"></div></div></div></body></html>`,"slides/details.html":`<html><head>${head}<style>body{background:#142c3a;color:#fff}.eyebrow{color:#85d8be}.grid{grid-template-columns:1fr 1fr}.card{color:#142c3a;border:0}</style></head><body><div class="eyebrow">02 / ARCHIVOS EDITABLES</div><h1>Una fuente por slide.</h1><div class="grid"><div class="card"><h2>Editar</h2><p>Cambiar esta página conserva la otra.</p></div><div><h2>Exportar</h2><p>Texto y formas como objetos nativos.</p><p>Efectos complejos por componente.</p></div></div></body></html>`}},datasets:[],assets:[]} as unknown as SealedArtifactInput;
 const deck=parseHtmlSlideDeck(input),html=await compileHtmlSlideDeck(input,deck);
 await writeFile(path.join(dir,"dashboard.html"),dashboard);await writeFile(path.join(dir,"slides.html"),html);
 const packet={version:1,kind:"slides-layout",width:deck.width,height:deck.height,pageCount:deck.slides.length,probes:[],html};
 const server=createServer(async(req,res)=>{
  try{
   if(req.method==="POST"&&req.url==="/layout"){
    let body="";for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16*1024*1024)throw new Error("too large");}
    const raw=JSON.parse(body),measured=measuredSlideDeck(deck,raw,input),pptx=await exportSlideDeckPptx(measured.deck,measured.input);await validateSlideDeckPptx(pptx,measured.deck);
    await writeFile(path.join(dir,"slides.pptx"),pptx);await writeFile(path.join(dir,"layout.json"),JSON.stringify(raw,null,2));
    res.setHeader("content-type","application/json");res.end(JSON.stringify({nativePptxVerified:true,slides:measured.deck.slides.length,objects:measured.deck.slides.map(s=>s.elements.length),componentImages:measured.rasterAssets.length,officeVerified:false}));return;
   }
   if(req.url==="/packet"){res.setHeader("content-type","application/json");res.end(JSON.stringify(packet));return;}
   res.setHeader("content-type","text/html; charset=utf-8");res.end(req.url==="/slides"?html:dashboard);
  }catch(error){res.statusCode=500;res.end(String(error));}
 });
 server.listen(3023,"127.0.0.1",()=>console.log("Synthetic breadth fixture on http://127.0.0.1:3023; no model/provider/database calls."));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
