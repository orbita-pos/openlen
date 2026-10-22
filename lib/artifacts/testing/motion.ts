import type { SealedArtifactInput } from "../types";
/** Trusted synthetic fixture. Caller supplies the actual frozen dashboard PNG. */
export function motionFixture(image:Uint8Array):SealedArtifactInput{
  const html=`<!doctype html><html><head><title>Len motion — prueba técnica</title><style>
*{box-sizing:border-box}body{margin:0;width:1280px;height:720px;overflow:hidden;background:#101820;color:#f5f5f1;font-family:Arial,sans-serif}.scene{position:absolute;inset:0;padding:64px}.eyebrow{font-size:17px;color:#75bda0;letter-spacing:3px}h1{font-size:58px;line-height:1.05;margin:24px 0 18px}p{font-size:26px;color:#b6c7cf}.chart{margin-top:64px;display:flex;gap:24px;align-items:end;height:220px}.column{display:flex;flex-direction:column;justify-content:end;align-items:center;gap:12px;width:280px}.bar{width:280px;background:#75bda0;transform-origin:bottom}.value{font-size:24px}.label{font-size:20px;color:#b6c7cf}#shot{width:1000px;height:460px;object-fit:contain;object-position:left top;margin-top:16px;border:1px solid #33444e}footer{position:absolute;bottom:24px;left:64px;font-size:15px;color:#a4b5bc}
</style></head><body><section id="chartScene" class="scene"><div class="eyebrow">LEN / PRUEBA TÉCNICA</div><h1>De datos a decisiones</h1><p>Compara un escenario antes de elegir.</p><div class="chart"><div class="column"><div class="value">120</div><div id="bar1" class="bar" style="height:180px"></div><div class="label">Norte</div></div><div class="column"><div class="value">80</div><div id="bar2" class="bar" style="height:120px;background:#5c8da6"></div><div class="label">Sur</div></div></div></section><section id="screenScene" class="scene"><div class="eyebrow">UNA CAPTURA CONGELADA</div><h1 style="font-size:44px">Explora el resultado</h1><img id="shot" src="asset:dashboard-capture" alt="Dashboard sintético de prueba"></section><footer>Escenario hipotético · dashboard sintético · video sin voz</footer><script src="main.ts"></script></body></html>`;
  const source=`const timeline=gsap.timeline({paused:true});
gsap.set('#screenScene',{autoAlpha:0});gsap.set(['#bar1','#bar2'],{scaleY:0});
timeline.fromTo('#bar1',{scaleY:0},{scaleY:1,duration:1.1,ease:'power2.out',immediateRender:false},.2);
timeline.fromTo('#bar2',{scaleY:0},{scaleY:1,duration:1.1,ease:'power2.out',immediateRender:false},.4);
timeline.fromTo('#chartScene',{autoAlpha:1,y:0},{autoAlpha:0,y:-20,duration:.45,immediateRender:false},2.65);
timeline.fromTo('#screenScene',{autoAlpha:0,y:22},{autoAlpha:1,y:0,duration:.6,immediateRender:false},2.8);
timeline.fromTo('#shot',{scale:.98},{scale:1,duration:2,ease:'none',immediateRender:false},3.3);
timeline.to({}, {duration:.7},5.3);timeline.pause(0);gsap.ticker.sleep();
const ready=Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode())]);
window.lenMotion={durationSeconds:6,ready:()=>ready,seek:async(t:number)=>{await ready;if(!Number.isFinite(t)||t<0||t>6)throw Error('invalid time');timeline.totalTime(t,true);}};`;
  return {artifact:{kind:"motion"},revision:{files:{"motion.json":JSON.stringify({version:1,entry:"index.html",runtime:"gsap-3.15.0",width:1280,height:720,fps:30,durationSeconds:6,datasetIds:[]}),"index.html":html,"main.ts":source}},assets:[{id:"dashboard-capture",mime:"image/png",bytes:image}],datasets:[]} as unknown as SealedArtifactInput;
}
/** Trial G2's video, reduced to what it needs to fail the seek check under GSAP's force3D "auto" (bisected on the
 *  real revision: without the later scene's zoom, or without its rising caption, it passed). A capture zooms out
 *  while the check samples the middle frame (3.0 s), so it is in 3D there; a later scene has its own zoom and a
 *  caption that rises; nothing is rendered before the first seek (Len's timelines do not pause(0) at build). Going
 *  back over the later scene leaves its elements transforms they did not have on the first pass, and Chromium
 *  layered the middle frame differently. */
export function midTweenMotionFixture(image:Uint8Array):SealedArtifactInput{
  const html=`<!doctype html><html lang="es"><head><title>Zoom en curso</title><style>
*{box-sizing:border-box;margin:0}body{width:1280px;height:720px;overflow:hidden;background:#0b1220;color:#f8fafc;font-family:Arial,sans-serif}
.scene{position:absolute;inset:0;opacity:0}.dark{display:flex;flex-direction:column;justify-content:center;padding:0 96px}
h1{font-size:96px;letter-spacing:-3px;line-height:1}p{font-size:34px;color:#94a3b8;margin-top:24px}
.shot{position:absolute;inset:0;width:1280px;height:720px;object-fit:cover}
.fade{position:absolute;left:0;right:0;bottom:0;height:300px;background:linear-gradient(to top,rgba(11,18,32,.97) 12%,rgba(11,18,32,.72) 55%,rgba(11,18,32,0) 100%)}
.caption{position:absolute;left:88px;right:88px;bottom:76px}.cap{font-size:46px;font-weight:600;line-height:1.18}.cap-sub{font-size:28px;color:#cbd5e1;margin-top:14px}
</style></head><body>
<div class="scene dark" id="s1"><h1>Reservas para barberías</h1><p>El cliente reserva desde su celular.</p></div>
<div class="scene" id="s2"><img class="shot" src="asset:dashboard-capture" alt="Captura sintética"><div class="fade"></div><div class="caption"><div class="cap">Reserva en 30 segundos, sin llamar.</div><div class="cap-sub">Elige servicio, hora y nombre.</div></div></div>
<div class="scene" id="s3"><img class="shot" src="asset:dashboard-capture" alt="Otra captura sintética"><div class="fade"></div><div class="caption"><div class="cap">La agenda del día, completa.</div><div class="cap-sub">Citas confirmadas y por confirmar.</div></div></div>
<div class="scene dark" id="s4"><h1>30 % menos citas perdidas</h1></div>
<script>
const tl=gsap.timeline({paused:true});
tl.fromTo("#s1",{opacity:0},{opacity:1,duration:.5,immediateRender:false},0);
tl.fromTo("#s1 h1",{opacity:0,y:26},{opacity:1,y:0,duration:.6,immediateRender:false},.2);
tl.to("#s1",{opacity:0,duration:.3},1.1);
tl.fromTo("#s2",{opacity:0},{opacity:1,duration:.5,immediateRender:false},1.4);
tl.fromTo("#s2 .shot",{scale:1.05},{scale:1,duration:2.6,ease:"power1.out",immediateRender:false},1.4);
tl.fromTo("#s2 .caption",{opacity:0,y:22},{opacity:1,y:0,duration:.6,immediateRender:false},1.8);
tl.to("#s2",{opacity:0,duration:.3},3.7);
tl.fromTo("#s3",{opacity:0},{opacity:1,duration:.4,immediateRender:false},4);
tl.fromTo("#s3 .shot",{scale:1.05},{scale:1,duration:1.1,ease:"power1.out",immediateRender:false},4);
tl.fromTo("#s3 .caption",{opacity:0,y:22},{opacity:1,y:0,duration:.5,immediateRender:false},4.2);
tl.to("#s3",{opacity:0,duration:.3},5.1);
tl.fromTo("#s4",{opacity:0},{opacity:1,duration:.4,immediateRender:false},5.4);
window.lenMotion={durationSeconds:6,ready:async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));},seek:async(t)=>{tl.totalTime(t,true);}};
</script></body></html>`;
  return {artifact:{kind:"motion"},revision:{files:{"motion.json":JSON.stringify({version:1,entry:"index.html",runtime:"gsap-3.15.0",width:1280,height:720,fps:30,durationSeconds:6,datasetIds:[]}),"index.html":html}},assets:[{id:"dashboard-capture",mime:"image/png",bytes:image}],datasets:[]} as unknown as SealedArtifactInput;
}
