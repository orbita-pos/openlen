const { chromium }=require('@playwright/test');const fs=require('fs'),path=require('path');const out=path.resolve('reports/movil-audit-navegacion');fs.mkdirSync(out,{recursive:true});
const base='http://127.0.0.1:5175';
const patch=`
const auditOrig=clienteDeMuestra.pedir.bind(clienteDeMuestra);let auditList=0;
clienteDeMuestra.pedir=async(r,i)=>{const s=new URLSearchParams(location.search).get('audit');
if(r==='/api/projects'){auditList++;if(s==='empty')return Response.json({projects:[]});if(s==='slow')await new Promise(q=>setTimeout(q,8000));if(s==='listError'&&auditList===1)return new Response(null,{status:503});if(s==='long')return Response.json({projects:Array.from({length:18},(_,k)=>({id:'m'+(k+1),title:k===0?'Tienda internacional de los mejores productos de Chihuahua y toda la república mexicana, panadería y repostería artesanal':('Proyecto número '+(k+1)+' — sucursal Centro Chihuahua'),subdomain:'sucursal-'+k,publishedAt:null,updatedAt:'2026-10-01T00:00:00Z'}))});}
if(s==='projectError'&&r==='/api/projects/m1')return new Response(null,{status:503});
if(s==='previewError'&&r.includes('/preview'))return new Response(null,{status:503});
if(s==='long'&&r.startsWith('/api/projects/m')){if(r.includes('/preview'))return auditOrig('/api/projects/m1/preview',i);const q=await auditOrig('/api/projects/m1',i);const j=await q.json();j.project.id=r.split('/').pop();j.project.title=j.project.id==='m1'?'Tienda internacional de los mejores productos de Chihuahua y toda la república mexicana, panadería y repostería artesanal':'Proyecto número '+j.project.id.slice(1)+' — sucursal Centro Chihuahua';return Response.json(j);}
return auditOrig(r,i);};`;
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});const results=[];try{for(const [w,h]of [[390,844],[360,640],[320,568]])for(const theme of ['light','dark']){
const ctx=await browser.newContext({viewport:{width:w,height:h},isMobile:true,hasTouch:true,locale:'es-MX',reducedMotion:theme==='dark'?'reduce':'no-preference'});await ctx.addInitScript(t=>localStorage.setItem('len-tema',t),theme);
await ctx.route('**/*',async rt=>{const u=new URL(rt.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname)&&!['data:','blob:'].includes(u.protocol))return rt.abort();if(u.pathname==='/src/muestra.ts'){const r=await rt.fetch();return rt.fulfill({response:r,body:(await r.text())+patch});}return rt.continue();});
const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));const snap=async name=>{await p.screenshot({path:path.join(out,w+'-'+theme+'-'+name+'.png')});results.push({w,h,theme,name,text:await p.locator('body').innerText(),errors:[...errors]});};
await p.goto(base+'/');await p.waitForTimeout(1300);await snap('login');
await p.goto(base+'/?muestra=1');await p.getByRole('button',{name:'Pedir un cambio',exact:true}).waitFor();await p.waitForTimeout(500);await snap('main');
await p.locator('.lm-dvbtn').click();await snap('sizes');await p.getByRole('menuitemradio').last().click();await snap('desktop');
await p.locator('.lm-bar-t').click();await snap('selector');
results.push({w,theme,targets:await p.locator('button').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().height&&getComputedStyle(e).visibility!=='hidden').map(e=>({text:e.textContent,label:e.getAttribute('aria-label'),box:{w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}})))});
await p.keyboard.press('Escape');results.push({w,theme,escapeSelector:await p.locator('.app-selector').count()});if(await p.locator('.app-selector').count())await p.locator('.app-selector .lm-grab').click();
await p.goto(base+'/?muestra=1&audit=empty');await p.waitForTimeout(500);await snap('empty');
await p.goto(base+'/?muestra=1&audit=listError');await p.getByRole('button',{name:'Reintentar',exact:true}).waitFor();await snap('list-error');await p.getByRole('button',{name:'Reintentar',exact:true}).click();await p.getByRole('button',{name:'Pedir un cambio',exact:true}).waitFor();
await p.goto(base+'/?muestra=1&audit=previewError');await p.getByRole('button',{name:'Pedir un cambio',exact:true}).waitFor();await p.locator('.app-aviso').waitFor();await snap('preview-error');
await p.goto(base+'/?muestra=1&audit=long');await p.getByRole('button',{name:'Pedir un cambio',exact:true}).waitFor();await snap('long-main');await p.locator('.lm-bar-t').click();await p.waitForTimeout(500);await snap('long-selector');
await p.locator('.app-selector .lm-body').evaluate(e=>e.scrollTop=e.scrollHeight);await snap('long-selector-bottom');await p.getByRole('button',{name:'Proyecto número 18',exact:false}).click();await p.waitForTimeout(500);await snap('changed');
await p.goto(base+'/?muestra=1&audit=slow');await p.waitForTimeout(1000);await snap('loading');await ctx.close();
}fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
