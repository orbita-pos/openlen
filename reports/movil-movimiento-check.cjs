const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs'); const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const salida=path.resolve('reports/movil-movimiento');fs.mkdirSync(salida,{recursive:true});
 try {
  for(const [width,height] of [[390,844],[360,640]]) for(const reduced of [false,true]) {
   const c=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,locale:'es-MX',reducedMotion:reduced?'reduce':'no-preference'});
   const p=await c.newPage();const errores=[];p.on('pageerror',e=>errores.push(e.message));
   await p.goto('http://127.0.0.1:5175/?muestra=1');
   for(const nombre of ['Publicar y gestionar','Tu Len','Antes / Ahora','Equipo e hilos']){
    await p.getByRole('button',{name:nombre,exact:true}).click();const capa=p.locator('.app-panel-motion');
    await expect(capa).toBeVisible();
    const animacion=await capa.evaluate(el=>getComputedStyle(el).animationName);
    expect(animacion).toBe(reduced?'none':'app-panel-entra');
    if(nombre==='Equipo e hilos'){
     await p.getByRole('textbox',{name:'Mensaje al equipo'}).fill('@Lu');await expect(p.getByRole('option',{name:/Luis/})).toBeVisible();
     await p.screenshot({path:path.join(salida,`${width}-${reduced?'reducido':'normal'}-equipo.png`),animations:'disabled'});
     await p.getByRole('textbox',{name:'Mensaje al equipo'}).fill('');
    }
    const dialogo=p.getByRole('dialog');
    await dialogo.getByRole('button',{name:nombre==='Tu Len'?'Cancelar':'Cerrar',exact:true}).click();
    if(!reduced && await capa.count()){
     expect(await capa.getAttribute('inert')).not.toBeNull();expect(await capa.getAttribute('aria-hidden')).toBe('true');
    }
    await expect(capa).toHaveCount(0);await expect.poll(()=>p.evaluate(()=>history.state?.lenCapa??0)).toBe(0);
   }
   // Reemplazar el tipo de panel durante su salida conserva la nueva capa.
   await p.getByRole('button',{name:'Publicar y gestionar',exact:true}).click();
   await p.getByRole('dialog').getByRole('button',{name:'Cerrar',exact:true}).click();
   await p.getByRole('button',{name:'Tu Len',exact:true}).click();
   await expect(p.locator('.tu-len')).toBeVisible();
   await expect.poll(()=>p.evaluate(()=>history.state?.lenCapa??0)).toBeGreaterThan(0);
   await p.getByRole('button',{name:'Cancelar',exact:true}).click();await expect(p.locator('.app-panel-motion')).toHaveCount(0);
   await expect.poll(()=>p.evaluate(()=>history.state?.lenCapa??0)).toBe(0);
   // Abrir el chat desde un panel que se está retirando no deja capas ni roba el foco.
   await p.getByRole('button',{name:'Equipo e hilos',exact:true}).click();
   await p.getByRole('textbox',{name:'Mensaje al equipo'}).fill('@Len revisa el horario');
   await p.getByRole('button',{name:'Enviar',exact:true}).click();
   await expect(p.locator('.lm-layer.lm-chat.is-on')).toBeVisible();
   await p.locator('.ch-foot textarea').focus();await expect(p.locator('.app-panel-motion')).toHaveCount(0);
   const conservaFoco=await p.locator('.ch-foot textarea').evaluate(el=>document.activeElement===el);
   await p.goBack();await expect(p.locator('.lm-layer.lm-chat.is-on')).toHaveCount(0);
   await expect.poll(()=>p.evaluate(()=>history.state?.lenCapa??0)).toBe(0);
   expect(conservaFoco).toBe(true);
   // Cambio del ajuste del sistema sin reiniciar: CSS y motor de la cara.
   await p.emulateMedia({reducedMotion:'reduce'});
   await expect.poll(()=>p.evaluate(()=>document.documentElement.classList.contains('len-reduced'))).toBe(true);
   await expect.poll(()=>p.evaluate(()=>window.LenCara?.reduced)).toBe(true);
   const efectos=await p.evaluate(()=>{
    const x=document.createElement('div');x.innerHTML='<div class="ch-typing"><i></i></div><div class="lm-halo" style="transform:scale(1.35)"><i></i></div>';
    document.querySelector('.app-lienzo').append(x);
    const r={puntos:getComputedStyle(x.querySelector('.ch-typing i')).animationName,halo:getComputedStyle(x.querySelector('.lm-halo')).transform};x.remove();return r;
   });expect(efectos).toEqual({puntos:'none',halo:'none'});
   await p.emulateMedia({reducedMotion:'no-preference'});await expect.poll(()=>p.evaluate(()=>window.LenCara?.reduced)).toBe(false);
   expect(errores).toEqual([]);console.log(`${width}×${height} ${reduced?'reducido':'normal'}: cuatro paneles, salida inerte, historial limpio, menciones y preferencia en vivo. Sin errores JS.`);await c.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
