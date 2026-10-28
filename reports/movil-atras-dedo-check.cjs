const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const dir=path.resolve('reports/movil-atras-dedo');fs.mkdirSync(dir,{recursive:true});
 try{for(const [width,height] of [[390,844],[360,640]])for(const reducido of [false,true]){
  const c=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,locale:'es-MX',reducedMotion:reducido?'reduce':'no-preference'});
  // Muestra local sin backend, modelos, mensajes ni cargas externas.
  await c.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:5175/')?r.continue():r.abort());
  const p=await c.newPage(),errores=[];p.on('pageerror',e=>errores.push(e.message));
  await p.goto('http://127.0.0.1:5175/?muestra=1');
  const cd=await c.newCDPSession(p);
  const touch=(type,x,y)=>cd.send('Input.dispatchTouchEvent',{type,touchPoints:['touchEnd','touchCancel'].includes(type)?[]:[{x,y}]});
  const quieto=async()=>{await p.locator('.app-panel-motion').evaluate(async e=>Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{}))));};
  const capa=p.locator('.app-panel-gesture');
  const xactual=()=>capa.evaluate(e=>e.getBoundingClientRect().x);
  const empezar=async()=>{await touch('touchStart',25,110);await touch('touchMove',50,110);await touch('touchMove',100,110);await expect.poll(xactual).toBeGreaterThan(50);};
  const terminar=async()=>{await touch('touchMove',230,110);await touch('touchEnd');};
  const cerrado=async()=>{await expect(capa).toHaveCount(0);await expect.poll(()=>p.evaluate(()=>history.state?.lenCapa??0)).toBe(0);};
  for(const nombre of ['Publicar y gestionar','Tu Len','Antes / Ahora','Equipo e hilos']){
   await p.getByRole('button',{name:nombre,exact:true}).tap();await expect(capa).toBeVisible();await quieto();
   // Cancelar conserva pantalla y limpia la posición sin pulsar un botón.
   await empezar();await touch('touchCancel');await expect.poll(xactual).toBeCloseTo(0,0);await expect(capa).toBeVisible();
   // Un movimiento corto vuelve; completar muestra progreso antes de salir.
   await touch('touchStart',25,110);await touch('touchMove',40,110);await touch('touchEnd');await expect.poll(xactual).toBeCloseTo(0,0);
   await empezar();if(width===390&&!reducido)await p.screenshot({path:path.join(dir,`${nombre.replaceAll(' / ','-').replaceAll(' ','-')}-gesto.png`)});
   await terminar();await cerrado();
  }
  // El carrusel recibe el gesto nativo en ambas direcciones; el scroll vertical también.
  await p.getByRole('button',{name:'Tu Len',exact:true}).tap();await quieto();
  const cards=p.locator('.tu-len-cards');await expect(cards.locator('button').first()).toBeVisible();
  const cb=await cards.boundingBox(),cy=cb.y+cb.height/2;
  await touch('touchStart',width-50,cy);await touch('touchMove',width-90,cy);await touch('touchMove',60,cy);await touch('touchEnd');
  await expect.poll(()=>cards.evaluate(e=>e.scrollLeft)).toBeGreaterThan(40);expect(await xactual()).toBeCloseTo(0,0);
  await touch('touchStart',70,cy);await touch('touchMove',120,cy);await touch('touchMove',width-50,cy);await touch('touchEnd');await expect(capa).toBeVisible();
  const scroll=p.locator('.tu-len-scroll');
  await scroll.evaluate(e=>{const espacio=document.createElement('div');espacio.style.height='500px';espacio.textContent='Contenido largo simulado para verificar scroll';e.append(espacio)});
  await touch('touchStart',width/2,260);await touch('touchMove',width/2,225);await touch('touchMove',width/2,140);await touch('touchEnd');
  await expect.poll(()=>scroll.evaluate(e=>e.scrollTop)).toBeGreaterThan(15);expect(await xactual()).toBeCloseTo(0,0);
  await empezar();await terminar();await cerrado();
  // Un hilo vuelve a la lista sin remontar Equipo; luego, al proyecto.
  await p.getByRole('button',{name:'Equipo e hilos',exact:true}).tap();await quieto();
  const panel=p.locator('.eq-panel');await panel.getByRole('button',{name:/^Hilos/}).tap();await panel.locator('.eq-hilo').first().tap();
  await expect(panel.locator('.eq-hilo-top')).toBeVisible();await expect.poll(()=>p.evaluate(()=>history.state?.lenCapa)).toBe(2);
  await panel.evaluate(e=>e.dataset.identidad='conservada');
  const campo=panel.getByRole('textbox',{name:'Mensaje al equipo'});await campo.fill('Borrador local');
  const tb=await campo.boundingBox();await touch('touchStart',tb.x+20,tb.y+tb.height/2);await touch('touchMove',tb.x+160,tb.y+tb.height/2);await touch('touchEnd');
  await expect(campo).toHaveValue('Borrador local');expect(await xactual()).toBeCloseTo(0,0);await expect(panel.locator('.eq-hilo-top')).toBeVisible();
  await empezar();await terminar();await expect(panel.locator('.eq-hilo-top')).toHaveCount(0);await expect(panel.locator('.eq-hilo').first()).toBeVisible();
  expect(await panel.getAttribute('data-identidad')).toBe('conservada');await expect.poll(()=>p.evaluate(()=>history.state?.lenCapa)).toBe(1);
  expect(await xactual()).toBeCloseTo(0,0);await empezar();await terminar();await cerrado();
  // Chat conserva su campo y sale con el gesto, incluso con altura de teclado.
  await p.locator('.lm-actions .lm-sec').tap();const chat=p.locator('.lm-layer.lm-chat.is-on');await expect(chat).toBeVisible();
  await expect.poll(()=>chat.evaluate(e=>e.getBoundingClientRect().x)).toBeCloseTo(0,0);
  await p.setViewportSize({width,height:400});const input=chat.locator('.ch-foot textarea');await input.fill('Sin enviar');
  const ib=await input.boundingBox();await touch('touchStart',ib.x+20,ib.y+ib.height/2);await touch('touchMove',Math.min(width-15,ib.x+170),ib.y+ib.height/2);await touch('touchEnd');await expect(input).toHaveValue('Sin enviar');
  await touch('touchStart',25,120);await touch('touchMove',65,120);await touch('touchMove',220,120);await expect.poll(()=>chat.evaluate(e=>e.getBoundingClientRect().x)).toBeGreaterThan(100);
  await touch('touchEnd');await expect(chat).toHaveCount(0);await expect.poll(()=>p.evaluate(()=>history.state?.lenCapa??0)).toBe(0);
  expect(errores).toEqual([]);console.log(`${width}×${height} ${reducido?'reducido':'normal'}: cuatro paneles siguen el dedo; cancelación, salida única, carrusel, scroll, campos, hilo→lista→proyecto y chat con teclado. Historial limpio, cero errores JS.`);
  await c.close();
 }}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
