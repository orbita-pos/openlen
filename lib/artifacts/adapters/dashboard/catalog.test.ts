// @vitest-environment node
import {afterAll,expect,it} from "vitest";
import {mkdtemp,readFile,writeFile,mkdir,cp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {artifactCatalog} from "./catalog";
import {compileArtifactHtml} from "./compile";
import {stopBundlerWorker} from "../../../apps/bundler/bundle-app";
import type {SealedArtifactInput} from "../../types";
import {Script} from "node:vm";
import {parse} from "node-html-parser";
import {compilarFuente} from "../../../apps/compilador";
afterAll(()=>stopBundlerWorker());
const input={revision:{files:{"index.html":'<html><head></head><body><div id="root"></div><script type="module" src="main.tsx"></script></body></html>',"main.tsx":'import React,{useState} from "react";import {createRoot} from "react-dom/client";import {BarChart,Bar,XAxis} from "recharts";function App(){const [n,set]=useState(1);return <><button onClick={()=>set(n+1)}>{n}</button><BarChart width={400} height={300} data={[{name:"North",value:120}]}><XAxis dataKey="name"/><Bar dataKey="value" isAnimationActive={false}/></BarChart></>};createRoot(document.getElementById("root")!).render(<App/>);'}},assets:[],datasets:[]} as unknown as SealedArtifactInput;
it("bundles actual React hooks and Recharts offline into one self-contained artifact",async()=>{
 const html=await compileArtifactHtml(input,"index.html",[]);
 expect(html).toContain("North");expect(html).not.toMatch(/(?:from|import\s*)\s*["'](?:react|recharts)/);
 expect(html).not.toContain('src="main.tsx"');expect(html.length).toBeGreaterThan(10000);
 for(const script of parse(html).querySelectorAll("script"))expect(()=>new Script(script.textContent)).not.toThrow();
},30000);
it("validates immutable catalog bytes and refuses missing/tampered packages",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"len-catalog-"));
 try{
  await mkdir(path.join(root,"2026-11"));
  await cp(path.join(process.cwd(),"public/app-vendor/2026-11"),path.join(root,"2026-11"),{recursive:true});
  const good=await artifactCatalog("2026-11",root);expect(good.catalogFiles.react).toContain("2026-11/react.js");
  const file=path.join(root,"2026-11/produccion/react.js");const before=await readFile(file,"utf8");
  await writeFile(file,before+"\n// changed");
  await expect(artifactCatalog("2026-11",root)).rejects.toMatchObject({code:"artifact_catalog_invalid"});
  await expect(artifactCatalog("../2026-11",root)).rejects.toMatchObject({code:"artifact_catalog_unavailable"});
 }finally{if(!path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+"len-catalog-"))throw new Error("unsafe temporary path");await rm(root,{recursive:true,force:true});}
},30000);
it("still rejects unresolved imports instead of resolving arbitrary npm or URLs",async()=>{
 const bad={...input,revision:{...input.revision,files:{...input.revision.files,"main.tsx":'import secret from "unprepared-package";document.title=secret;'}}};
 await expect(compileArtifactHtml(bad,"index.html",[])).rejects.toBeDefined();
});
it("bakes imported CSS and Tailwind locally without a stylesheet request or inert runtime style",async()=>{
 const files={...input.revision.files,"main.tsx":'import "./theme.css";document.body.dataset.ready="yes";',"theme.css":"#root{@apply text-5xl;font-weight:bold}"};
 const html=await compileArtifactHtml({...input,revision:{...input.revision,files}},"index.html",[]);
 const appended:Record<string,unknown>[]=[];
 const document={querySelector:()=>null,createElement:(tag:string)=>({tag,dataset:{},setAttribute:()=>{}}),head:{append:(el:Record<string,unknown>)=>appended.push(el)},body:{dataset:{}}};
 const script=parse(html).querySelector('script[type="module"]')!.textContent;
 new Script(script).runInNewContext({document});
 expect(appended).toHaveLength(1);expect(appended[0]!.tag).toBe("style");
 expect(appended[0]!.type).not.toBe("text/tailwindcss");expect(appended[0]!.textContent).toContain("3rem");
});
it("keeps inline artifact CSS compilation separate from normal app cache entries",()=>{
 const ctx={carpeta:{"/main.ts":'import "./cache.css";',"/cache.css":"h1{color:red}"},catalogo:"2026-11"};
 const normal=compilarFuente("/main.ts",ctx.carpeta["/main.ts"],ctx);
 const inline=compilarFuente("/main.ts",ctx.carpeta["/main.ts"],{...ctx,inlineStyles:true});
 expect(normal.ok&&normal.js).toContain('createElement("link")');
 expect(inline.ok&&inline.js).toContain('createElement("style")');
});
