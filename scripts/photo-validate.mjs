// Render-validate enhanced templates vs originals: catches broken/collapsed
// pages (agent mangled the HTML) + images that fail to load. Prints PASS/FAIL.
// Run: node scripts/photo-validate.mjs <enhancedDir> <id...>
import { readFile } from "node:fs/promises"; import { existsSync } from "node:fs";
import { join } from "node:path"; import puppeteer from "puppeteer";
function chrome(){for(const c of["C:\Program Files\Google\Chrome\Application\chrome.exe","C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe","C:\Program Files\Microsoft\Edge\Application\msedge.exe"])if(existsSync(c))return c;}
const dir=process.argv[2]; const ids=process.argv.slice(3);
const b=await puppeteer.launch({headless:true,executablePath:chrome(),args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]});
async function measure(html){
  const p=await b.newPage(); await p.setViewport({width:1100,height:800,deviceScaleFactor:1});
  try{await p.setContent(html,{waitUntil:"networkidle0",timeout:25000})}catch{}
  await new Promise(r=>setTimeout(r,1500));
  const m=await p.evaluate(()=>{
    const imgs=[...document.querySelectorAll('img')];
    return { h: document.body.scrollHeight,
      imgs: imgs.length,
      brokenImgs: imgs.filter(i=>i.complete && i.naturalWidth===0).length,
      ol: imgs.filter(i=>(i.currentSrc||i.src||'').includes('images.openlen.com')).length };
  });
  await p.close(); return m;
}
console.log("id".padEnd(20),"verdict".padEnd(8),"enh_h/orig_h","olImgs","broken");
let fails=[];
for(const id of ids){
  const enh=await readFile(join(dir,id+".html"),"utf8");
  const orig=await readFile(".photo-export/"+id+".html","utf8");
  const e=await measure(enh), o=await measure(orig);
  const ratio=o.h? e.h/o.h : 1;
  const ok = ratio>=0.6 && e.h>1200 && e.brokenImgs===0;
  if(!ok) fails.push(id);
  console.log(id.padEnd(20), (ok?"PASS":"FAIL").padEnd(8), `${e.h}/${o.h} (${ratio.toFixed(2)})`.padEnd(13), String(e.ol).padEnd(6), e.brokenImgs);
}
await b.close();
console.log("\nFAILS:", fails.length? fails.join(" ") : "none");
