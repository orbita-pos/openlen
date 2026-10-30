const {chromium,expect}=require('@playwright/test');const fs=require('node:fs'),path=require('node:path');
(async()=>{const b=await chromium.launch({channel:'msedge',headless:true});const dir=path.resolve('reports/movil-adjuntos');fs.mkdirSync(dir,{recursive:true});
try{for(const [width,height] of [[390,844],[360,640]]){
 const c=await b.newContext({viewport:{width,height},isMobile:true,hasTouch:true,locale:'es-MX'});
 // El cliente de muestra responde en memoria; además se bloquea cualquier red externa.
 await c.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname==='127.0.0.1'?r.continue():r.abort()});
 const p=await c.newPage();const errores=[];p.on('pageerror',e=>errores.push(e.message));
 await p.goto('http://127.0.0.1:5175/?muestra=1');
 await p.evaluate(async()=>{
  const m=await import('/src/muestra.ts');m.RITMO.x=0;const real=m.clienteDeMuestra.pedir;
  window.enviosQA=[];window.falloQA=false;
  m.clienteDeMuestra.pedir=async(ruta,init)=>{
   if(ruta==='/api/upload'){const f=init.body.get('file');window.enviosQA.push({ruta,name:f.name,tipo:f.type,project:init.body.get('generationId')});if(f.name==='ventas.xlsx'&&!window.falloQA){window.falloQA=true;return new Response(null,{status:503})}}
   if(ruta==='/api/agent')window.enviosQA.push({ruta,body:JSON.parse(init.body)});
   return real(ruta,init);
  };
 });
 await p.getByRole('button',{name:'Pedir un cambio',exact:true}).tap();
 const chat=p.locator('.lm-layer.lm-chat.is-on'),plus=chat.getByRole('button',{name:'Adjuntar',exact:true});
 await plus.tap();await expect(chat.getByRole('dialog',{name:'Adjuntar'})).toBeVisible();
 await p.screenshot({path:path.join(dir,`${width}-menu.png`),animations:'disabled'});
 await p.goBack();await expect(chat.getByRole('dialog')).toHaveCount(0);await expect(chat).toBeVisible();
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
 for(const nombre of ['Cámara','Fotos']){
  await plus.tap();const [selector]=await Promise.all([p.waitForEvent('filechooser'),chat.getByRole('button',{name:nombre,exact:true}).click()]);
  expect(await selector.element().getAttribute('capture')).toBe(nombre==='Cámara'?'environment':null);
  await selector.setFiles({name:'foto.png',mimeType:'image/png',buffer:png});await expect(chat.locator('.app-adjunta img')).toBeVisible();
 }
 await chat.getByRole('button',{name:'Quitar la foto',exact:true}).tap();
 await plus.tap();const [selector]=await Promise.all([p.waitForEvent('filechooser'),chat.getByRole('button',{name:'Archivos',exact:true}).click()]);
 await selector.setFiles([{name:'lista.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 muestra')},{name:'ventas.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('PK muestra')}]);
 await expect(chat.locator('.app-archivo-pendiente')).toHaveCount(2);
 await p.screenshot({path:path.join(dir,`${width}-previa.png`),animations:'disabled'});
 await p.setViewportSize({width,height:400});await expect(chat.locator('.app-pendientes')).toBeVisible();
 await expect.poll(async()=>{const pie=await chat.locator('.ch-foot').boundingBox();return pie.y+pie.height;}).toBeLessThanOrEqual(401);
 await plus.tap();const menu=await chat.getByRole('dialog',{name:'Adjuntar'}).boundingBox();expect(menu.y).toBeGreaterThanOrEqual(0);
 await chat.getByRole('button',{name:'Cancelar',exact:true}).tap();await p.setViewportSize({width,height});

 // Se puede quitar y volver a adjuntar antes de enviar.
 await chat.getByRole('button',{name:'Quitar ventas.xlsx',exact:true}).tap();await expect(chat.locator('.app-archivo-pendiente')).toHaveCount(1);
 await chat.locator('input[data-origen=archivos]').setInputFiles({name:'ventas.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('PK muestra')});
 await chat.getByRole('button',{name:'Enviar',exact:true}).tap();
 await expect(chat.getByText('No se pudieron subir',{exact:false})).toBeVisible();
 await chat.getByRole('button',{name:'Reintentar',exact:true}).tap();
 await expect.poll(()=>p.evaluate(()=>window.enviosQA.filter(x=>x.ruta==='/api/agent').length)).toBe(1);
 const envios=await p.evaluate(()=>window.enviosQA);expect(envios.filter(x=>x.name==='lista.pdf')).toHaveLength(1);expect(envios.filter(x=>x.name==='ventas.xlsx')).toHaveLength(2);
 const mensaje=envios.find(x=>x.ruta==='/api/agent').body;expect(mensaje.attachedFiles).toHaveLength(2);expect(mensaje.attachedFiles[1].kind).toBe('xlsx');expect(mensaje.prompt).toContain('archivos adjuntos');expect(envios.filter(x=>x.name).every(x=>x.project==='m1')).toBe(true);
 await expect(chat.locator('.ch-file').filter({hasText:'ventas.xlsx'})).toBeVisible();
 await expect(plus).toBeEnabled();
 await chat.locator('input[data-origen=archivos]').setInputFiles({name:'app.exe',mimeType:'application/octet-stream',buffer:Buffer.from('x')});
 await expect(chat.getByRole('alert')).toContainText('no es compatible');await expect(chat.locator('.app-archivo-pendiente')).toHaveCount(0);
 await p.screenshot({path:path.join(dir,`${width}-enviado.png`),animations:'disabled'});
 expect(errores).toEqual([]);console.log(`${width}: cámara/fotos (selector simulado), PDF+Excel, quitar, subida con proyecto, fallo/reintento sin duplicados y rechazo de formato. Sin red externa ni errores JS.`);
 await c.close();
}}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
