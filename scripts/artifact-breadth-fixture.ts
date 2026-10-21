import {createServer} from "node:http";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import path from "node:path";
import {buildDashboard} from "../lib/artifacts/adapters/dashboard/compile";
import {compileSlideDeck,parseSlideDeckV3,SLIDE_WIDTH,SLIDE_HEIGHT} from "../lib/artifacts/adapters/slides/deck";
import {exportNativeDeck,parseMeasuredDeck,validateNativeDeck} from "../lib/artifacts/adapters/slides/native";
import {slidesV3Fixture} from "../lib/artifacts/testing/slides-v3";
import type {SealedArtifactInput} from "../lib/artifacts/types";
async function main(){
 const dir=path.resolve(process.argv[2]??"");if(!process.argv[2])throw new Error("Pass an output directory");await mkdir(dir,{recursive:true});
 const dashboardInput={artifact:{kind:"dashboard"},revision:{files:{"dashboard.json":JSON.stringify({entry:"index.html",catalogo:"2026-11",width:1280,height:720,datasetIds:["sales"]}),"index.html":'<html lang="es"><head></head><body><div id="root"></div><script type="module" src="main.tsx"></script></body></html>',"theme.css":'body{margin:0;background:#101c2a;color:#eef6ff;font-family:Arial}#root{padding:48px}select{font:inherit;padding:10px}h1{font-size:40px}#total{@apply text-5xl font-bold} .recharts-wrapper{margin-top:30px}',"main.tsx":`import React,{useState,useEffect} from "react";import {createRoot} from "react-dom/client";import {BarChart,Bar,XAxis,YAxis,CartesianGrid,Tooltip} from "recharts";import "./theme.css";let done;window.lenReady=new Promise(resolve=>done=resolve);function App(){const [zone,set]=useState('Todas');const rows=window.lenData.datasets[0].rows.filter(r=>zone==='Todas'||r[0]===zone).map(r=>({zone:r[0],sales:r[1]}));useEffect(()=>{done()},[]);return <><p>PRUEBA TÉCNICA · DATOS SINTÉTICOS</p><h1>Ventas por región</h1><label>Región <select id="zone" value={zone} onChange={e=>set(e.target.value)}><option>Todas</option><option>Norte</option><option>Sur</option></select></label><p id="total">{rows.reduce((sum,r)=>sum+r.sales,0)}</p><BarChart width={1050} height={350} data={rows}><CartesianGrid stroke="#344052" vertical={false}/><XAxis dataKey="zone" stroke="#eef6ff"/><YAxis stroke="#eef6ff"/><Tooltip/><Bar dataKey="sales" fill="#85d8be" isAnimationActive={false}/></BarChart></>};createRoot(document.getElementById('root')).render(<App/>);`}},datasets:[{id:"sales",mode:"scenario",environment:null,columns:["Zona","Ventas"],rows:[["Norte",120],["Sur",80]],source:"scenario",capturedAt:new Date().toISOString(),truncated:false}],assets:[]} as unknown as SealedArtifactInput;
 const dashboard=(await buildDashboard(dashboardInput)).html;
 const input=slidesV3Fixture(new Uint8Array(await readFile("public/icon-512.png")));
 const deck=parseSlideDeckV3(input),html=compileSlideDeck(deck,input);
 await writeFile(path.join(dir,"dashboard.html"),dashboard);await writeFile(path.join(dir,"slides.html"),html);
 const packet={version:1,kind:"slides-layout",width:SLIDE_WIDTH,height:SLIDE_HEIGHT,pageCount:deck.slides.length,probes:[],html};
 const server=createServer(async(req,res)=>{
  try{
   if(req.method==="POST"&&req.url==="/layout"){
    let body="";for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16*1024*1024)throw new Error("too large");}
    const raw=JSON.parse(body),measured=parseMeasuredDeck(raw,deck.slides.map(s=>s.id)),pptx=await exportNativeDeck(deck.title,deck.slides,measured,{image:id=>input.assets.find(a=>a.id===id)});await validateNativeDeck(pptx,measured);
    await writeFile(path.join(dir,"slides.pptx"),pptx);await writeFile(path.join(dir,"layout.json"),JSON.stringify(raw,null,2));
    res.setHeader("content-type","application/json");res.end(JSON.stringify({nativePptxVerified:true,slides:measured.slides.length,objects:measured.slides.map(s=>s.elements.length),drawingsAsPictures:measured.assets.length,officeVerified:false}));return;
   }
   if(req.url==="/packet"){res.setHeader("content-type","application/json");res.end(JSON.stringify(packet));return;}
   res.setHeader("content-type","text/html; charset=utf-8");res.end(req.url==="/slides"?html:dashboard);
  }catch(error){res.statusCode=500;res.end(String(error));}
 });
 server.listen(3023,"127.0.0.1",()=>console.log("Synthetic breadth fixture on http://127.0.0.1:3023; no model/provider/database calls."));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
