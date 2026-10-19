import {createRequire} from "node:module";
import {buildDashboard} from "./adapters/dashboard/compile";
import {buildMotion} from "./adapters/motion/runtime";
import {parseSlideDeck} from "./adapters/slides/manifest";
import {exportSlideDeckPptx,validateSlideDeckPptx} from "./adapters/slides/pptx";
import {dashboardFixture} from "./testing/dashboard";
import {stopBundlerWorker} from "../apps/bundler/bundle-app";
import type {SealedArtifactInput} from "./types";
/** Install smoke only: trusted fixtures, no DB/provider call or authored Node. */
export async function verifyArtifactInstallation(){
  try{
    const dashboard=await buildDashboard(dashboardFixture());
    if(!dashboard.html.includes("Norte")||!dashboard.csv[0]?.text.includes("120"))throw new Error("dashboard install check failed");
    const {compileArtifactHtml}=await import("./adapters/dashboard/compile");
    const catalogSource={...dashboardFixture(),revision:{...dashboardFixture().revision,files:{"index.html":'<html><head></head><body><div id="root"></div><script type="module" src="main.tsx"></script></body></html>',"theme.css":"#root{@apply text-5xl}","main.tsx":'import "./theme.css";import React from "react";import {createRoot} from "react-dom/client";import {BarChart,Bar} from "recharts";createRoot(document.getElementById("root")).render(<BarChart width={400} height={200} data={[{value:120}]}><Bar dataKey="value" isAnimationActive={false}/></BarChart>);'}}};
    const catalogHtml=await compileArtifactHtml(catalogSource,"index.html",[]);if(catalogHtml.length<10000||!catalogHtml.includes("3rem"))throw new Error("artifact React/Recharts/CSS catalog missing");
    const slides={artifact:{kind:"slides"},revision:{files:{"deck.json":JSON.stringify({version:1,width:1280,height:720,title:"Install check",slides:[{id:"cover",elements:[{id:"title",type:"text",x:64,y:64,w:1100,h:100,text:"Instalación",fontSize:48}]}]})}},assets:[],datasets:[]} as unknown as SealedArtifactInput;
    const deck=parseSlideDeck(slides);await validateSlideDeckPptx(await exportSlideDeckPptx(deck,slides),deck);
    const motion={artifact:{kind:"motion"},revision:{files:{"motion.json":JSON.stringify({version:1,entry:"index.html",runtime:"gsap-3.15.0",width:1280,height:720,fps:30,durationSeconds:1,datasetIds:[]}),"index.html":"<!doctype html><html><head></head><body><h1>Instalación</h1></body></html>"}},assets:[],datasets:[]} as unknown as SealedArtifactInput;
    if(!(await buildMotion(motion)).html.includes("GSAP 3.15.0"))throw new Error("motion runtime missing");
    const native=createRequire(import.meta.url)("@openlen/images") as typeof import("@openlen/images");
    if(typeof native.processImage!=="function")throw new Error("image binding missing");
    return {sourceCompiler:true,reactRechartsCatalog:true,tailwindStyles:true,pptxNativeObjects:true,gsapRuntime:"3.15.0",imageNativeBinding:true,renderContainerVerified:false};
  }finally{stopBundlerWorker();}
}
