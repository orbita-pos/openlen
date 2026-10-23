// @vitest-environment node
import {expect,it} from "vitest";
import {createServer} from "node:http";
import {readFile,mkdir} from "node:fs/promises";
import {join} from "node:path";
import {build} from "esbuild";
import puppeteer from "puppeteer";
const run=process.env.ARTIFACT_BROWSER_TESTS==="1"?it:it.skip;
run("keeps the whole sandbox viewport and its controls usable after width and height changes",async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {FittedPreview} from './components/workspace-v2/artifacts/fitted-preview';createRoot(document.getElementById('root')).render(React.createElement(FittedPreview,{frame:{width:1280,height:720},title:'Dashboard',url:location.search?'/actual':'/child'}));`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},tsconfig:"tsconfig.json"});
  const child=`<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;width:1280px;height:720px;overflow:hidden}body{background:#eff3f8;padding:32px;font:24px sans-serif}main{height:100%;border:3px solid #456}button{position:absolute;right:12px;bottom:12px;font-size:24px}select{font-size:24px}</style></head><body><main><h1>Full dashboard</h1><select aria-label="Month" onchange="document.querySelector('output').textContent=this.value"><option>September</option><option>October</option></select><output>September</output><button onclick="this.textContent=String(Number(this.textContent)+1)">0</button></main></body></html>`;
  const server=createServer((req,res)=>{void(async()=>{
    if(req.url==="/app.js"){res.setHeader("content-type","text/javascript");res.end(bundle.outputFiles[0]!.text);}
    else if(req.url==="/child"){res.setHeader("content-type","text/html");res.end(child);}
    else if(req.url==="/actual"&&process.env.ARTIFACT_FIT_REVIEW_HTML){res.setHeader("content-type","text/html");res.end(await readFile(process.env.ARTIFACT_FIT_REVIEW_HTML));}
    else{res.setHeader("content-type","text/html");res.end('<!doctype html><style>html,body{margin:0;background:#171717}#root{width:100%}</style><div id="root"></div><script src="/app.js"></script>');}
  })().catch(()=>{res.statusCode=500;res.end();});});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();if(!address||typeof address==="string")throw new Error("missing test address");
  let browser;
  try{
    browser=await puppeteer.launch({headless:true,...(process.env.ARTIFACT_TEST_BROWSER_EXECUTABLE?{executablePath:process.env.ARTIFACT_TEST_BROWSER_EXECUTABLE}:{})});
    const page=await browser.newPage();await page.setViewport({width:700,height:650});await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForSelector("iframe");const iframe=await page.$("iframe");const frame=await iframe!.contentFrame();if(!frame)throw new Error("missing child");await frame.waitForSelector("button");
    for(const size of [{width:700,height:650},{width:360,height:640},{width:1200,height:360},{width:2000,height:1400}]){
      await page.setViewport(size);
      await page.waitForFunction(()=>{const iframe=document.querySelector("iframe")!,area=iframe.parentElement!.parentElement!,r=iframe.getBoundingClientRect(),a=area.getBoundingClientRect();return Math.abs(r.width-1280*Math.min(1,a.width/1280,a.height/720))<1&&r.width>0&&r.left>=a.left-1&&r.top>=a.top-1&&r.right<=a.right+1&&r.bottom<=a.bottom+1;});
      const geometry=await page.evaluate(()=>{const f=document.querySelector("iframe")!,r=f.getBoundingClientRect();return {width:r.width,height:r.height,overflow:document.documentElement.scrollWidth>innerWidth,sandbox:f.getAttribute("sandbox")};});
      expect(geometry.width/geometry.height).toBeCloseTo(1280/720,4);expect(geometry.width).toBeLessThanOrEqual(1280);expect(geometry.overflow).toBe(false);expect(geometry.sandbox).toBe("allow-scripts");
      expect(await frame.evaluate(()=>({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight}))).toEqual({width:1280,height:720,overflow:false});
      // Physical pointer coordinates, including the iframe transform (Frame.click assumes an unscaled iframe).
      const button=await frame.$eval("button",node=>{const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
      const point=await page.evaluate(button=>{const r=document.querySelector("iframe")!.getBoundingClientRect();return {x:r.x+button.x*r.width/1280,y:r.y+button.y*r.height/720};},button);
      await page.mouse.click(point.x,point.y);
    }
    expect(await frame.$eval("button",node=>node.textContent)).toBe("4");
    await frame.select("select","October");expect(await frame.$eval("output",node=>node.textContent)).toBe("October");
    if(process.env.ARTIFACT_FIT_REVIEW_HTML&&process.env.ARTIFACT_REVIEW_DIR){
      await page.setViewport({width:697,height:642});await page.goto(`http://127.0.0.1:${address.port}/?actual`);await page.waitForSelector("iframe");const f=await(await page.$("iframe"))!.contentFrame();await f!.waitForSelector("svg");await page.waitForFunction(()=>document.querySelector("iframe")!.getBoundingClientRect().width>0);
      await mkdir(process.env.ARTIFACT_REVIEW_DIR,{recursive:true});await(await page.$("#root"))!.screenshot({path:join(process.env.ARTIFACT_REVIEW_DIR,"dashboard-viewer-fit.png")});
    }
  }finally{await browser?.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
},60_000);
