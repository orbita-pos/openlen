const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});
 const dir=path.resolve('reports/movil-audit-chat');fs.mkdirSync(dir,{recursive:true});const fallos=[];
 const comprobar=async(nombre,fn)=>{try{await fn();console.log('OK',nombre)}catch(e){fallos.push({nombre,error:e.message.split('Call log:')[0]});console.log('FALLO',nombre,e.message.split('\n')[0])}};
 try{for(const [width,height] of [[390,844],[360,640],[320,568]]){
  const c=await b.newContext({viewport:{width,height},isMobile:true,hasTouch:true,locale:'es-MX'});
  await c.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:5175/')?r.continue():r.abort());
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  const foto=nombre=>p.screenshot({path:path.join(dir,`${width}-${nombre}.png`),animations:'disabled'});
  await p.goto('http://127.0.0.1:5175/?muestra=1');await p.locator('.lm-actions .lm-sec').tap();
  const chat=p.locator('.lm-layer.lm-chat.is-on'),campo=chat.getByRole('textbox',{name:'Mensaje',exact:true}),log=chat.locator('.ch-log');
  await expect(chat).toBeVisible();await foto('chat-inicial');
  await campo.fill('Este es un mensaje largo que quiero revisar antes de mandarlo. '.repeat(8));
  await foto('componer-largo');
  await comprobar(`${width}: el campo crece para revisar un mensaje largo`,async()=>expect((await campo.boundingBox()).height).toBeGreaterThan(65));
  await campo.fill('');
  await p.evaluate(async()=>{
   const m=await import('/src/muestra.ts');const pedir=m.clienteDeMuestra.pedir.bind(m.clienteDeMuestra);
   window.__qaEnviar=(nombre,datos)=>window.__qaControl.enqueue(new TextEncoder().encode(`event: ${nombre}\ndata: ${JSON.stringify(datos)}\n\n`));
   m.clienteDeMuestra.pedir=async(ruta,init)=>{
    if(ruta==='/api/agent')return new Response(new ReadableStream({start(c){window.__qaControl=c}}),{headers:{'content-type':'text/event-stream'}});
    return pedir(ruta,init);
   };
  });
  await campo.fill('Cuéntame todos los cambios de la página');await campo.press('Enter');await p.waitForFunction(()=>!!window.__qaControl);
  await comprobar(`${width}: envío pendiente no aparece leído`,async()=>expect(await chat.locator('.ch-rcpt').last().innerText()).not.toBe('Leído'));
  await foto('esperando-servidor');
  await p.evaluate(()=>window.__qaEnviar('turno',{turnoId:'qa-turno'}));
  await p.evaluate(()=>window.__qaEnviar('text',{text:'Primer párrafo de respuesta. '}));await expect(log).toContainText('Primer párrafo de respuesta.');
  for(let i=0;i<8;i++){await p.evaluate(()=>window.__qaEnviar('text',{text:'La portada y el horario están listos para verse en el teléfono. '.repeat(4)}));await p.evaluate(()=>new Promise(requestAnimationFrame));}
  await foto('respuesta-larga-en-vivo');
  await comprobar(`${width}: sigue el final mientras crece un párrafo en vivo`,async()=>expect(await log.evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop)).toBeLessThan(3));
  await log.evaluate(e=>{e.scrollTop=0;e.dispatchEvent(new Event('scroll'))});await p.evaluate(()=>new Promise(requestAnimationFrame));
  await p.evaluate(()=>window.__qaEnviar('text',{text:'\n\nSegundo párrafo que llega mientras lees el principio.'}));await expect(log).toContainText('Segundo párrafo');
  await comprobar(`${width}: respeta la lectura de mensajes anteriores`,async()=>expect(await log.evaluate(e=>e.scrollTop)).toBeLessThan(10));
  await foto('lectura-anterior');
  await comprobar(`${width}: permite volver al último mensaje`,async()=>{const boton=chat.getByRole('button',{name:'Ir al último mensaje',exact:true});await expect(boton).toBeVisible();await boton.tap();expect(await log.evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop)).toBeLessThan(3)});
  await p.evaluate(()=>window.__qaControl.close());
  await expect(chat.getByRole('button',{name:'Adjuntar',exact:true})).toBeEnabled();
  // El pie debe ocupar su alto real con texto y adjuntos, también con teclado.
  await p.setViewportSize({width,height:400});await campo.fill('Primera línea\nSegunda línea\nTercera línea');
  await chat.getByRole('button',{name:'Adjuntar',exact:true}).tap();
  const chooser=p.waitForEvent('filechooser');await chat.getByRole('button',{name:'Archivos',exact:true}).tap();
  await (await chooser).setFiles({name:'presupuesto-con-nombre-largo-del-proyecto.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 ejemplo')});
  await foto('teclado-adjunto');
  await comprobar(`${width}: el campo y pie se mantienen dentro de pantalla`,async()=>{const box=await campo.boundingBox();expect(box.y).toBeGreaterThan(0);expect(box.y+box.height).toBeLessThanOrEqual(400)});
  await p.setViewportSize({width,height});await p.evaluate(async()=>{(await import('/src/tema.ts')).aplicarTema('dark')});await foto('chat-oscuro');
  expect(errors).toEqual([]);await c.close();
 }
 }finally{await b.close();fs.writeFileSync(path.join(dir,'hallazgos.json'),JSON.stringify(fallos,null,2));}
 console.log(JSON.stringify({fallos:fallos.length}));if(fallos.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
