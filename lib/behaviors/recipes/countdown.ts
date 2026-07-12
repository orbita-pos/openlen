import type { Behavior } from "../types";

// Un querySelectorAll + loop, NO delegación (a diferencia de filter/lightbox):
// esta conducta la dispara el RELOJ, no un evento, así que no hay nada que
// delegar — cada [data-ol-countdown] necesita su propio setInterval. El loop
// envuelve cada iteración en su propia IIFE `(function(r){...})(L[i])` para
// que `t`, `p`, `e`, `iv` y la función `tick` vivan en un closure POR
// INSTANCIA; sin eso, dos contadores en la misma página compartirían el mismo
// `var iv` (mismo scope de función) y el segundo pisaría el intervalo del
// primero.
//
// olEditing() es LO PRIMERO que hace tick(), antes de tocar el DOM: en el
// preview del editor el creador puede tener el cursor puesto dentro del
// contador (editando el texto alrededor de los spans) y reescribirle el
// textContent cada segundo le saltaría el cursor y le corrompería la
// edición. Es la razón de ser del guard en esta receta más que en ninguna
// otra — filter/lightbox solo evitan secuestrar un click.
//
// `iv=setInterval(tick,1000)` se asigna ANTES de la llamada inicial a
// tick() (no después): así, si el contador YA expiró al montar (fecha
// pasada), la primera pintura ve un `iv` ya válido y `clearInterval(iv)`
// cancela de inmediato el intervalo recién creado — cero ticks de más. Al
// revés (llamar tick() y asignar iv después) el primer tick vería `iv`
// todavía `undefined`, dejaría el setInterval vivo, y haría falta un segundo
// tick (1s más tarde) para limpiarlo.
//
// El ternario de `v` cae en -1 (nunca se escribe: `v>=0` lo filtra) si un
// [data-ol-cd] trae un valor fuera de days/hours/mins/secs — degrada
// callándose en vez de escribir el número equivocado en el bucket que no le
// toca.
const JS = `var L=document.querySelectorAll('[data-ol-countdown]');for(var i=0;i<L.length;i++)(function(r){var t=Date.parse(r.getAttribute('data-ol-countdown')),p=r.querySelectorAll('[data-ol-cd]'),e=r.querySelector('[data-ol-cd-ended]'),iv=setInterval(tick,1000);function tick(){if(olEditing())return;var d=t-Date.now();if(d<=0){clearInterval(iv);r.style.display='none';if(e)e.style.display='';return}var s=Math.floor(d/1000),D=Math.floor(s/86400),h=Math.floor(s/3600)%24,m=Math.floor(s/60)%60,c=s%60;for(var j=0;j<p.length;j++){var k=p[j].getAttribute('data-ol-cd'),v=k==='days'?D:k==='hours'?h:k==='mins'?m:k==='secs'?c:-1;if(v>=0)p[j].textContent=(v<10?'0':'')+v}}tick()})(L[i]);`;

export const countdown: Behavior = {
  name: "countdown",
  marker: "data-ol-countdown",
  schema: {
    root: { kind: "isoDate" },
    parts: [{ selector: "[data-ol-cd]", min: 1, why: "sin un hijo [data-ol-cd] no hay dónde escribir el tiempo" }],
  },
  js: JS,
  budgetBytes: 700,
  // control-inert, no content-intact: sin runtime se ven los ceros que
  // escribió la IA en el ejemplo (feo, pero no roto) — y por eso el arnés
  // permite que [data-ol-cd-ended] nazca con style="display:none": su estado
  // ANTES de expirar es estar oculto, y el check de "nada nace oculto" del
  // conformance harness solo corre para content-intact. Si esto fuera
  // content-intact el arnés tendría razón en ponerse rojo — no es el caso.
  degradation: "control-inert",
  // Deliberadamente vacío: un contador que reescribe su texto cada segundo
  // con aria-live le gritaría al lector de pantalla 60 veces por minuto.
  a11y: [],
  doc: {
    when: "Una oferta, lanzamiento o evento con fecha y hora límite REAL (cierre de una promoción, inicio de un webinar, fin de una preventa) donde el visitante necesita ver el tiempo restante corriendo en vivo.",
    whenNot: "No la actives sin una fecha real detrás — al expirar sin que nada cambie, el visitante se queda viendo 'terminó' o ceros congelados para siempre. Y si el ISO no lleva offset de zona horaria (-06:00, +01:00…), el instante es LOCAL AL VISITANTE: una oferta que 'cierra a las 20:00' terminaría a horas distintas en México y en España — usa un offset explícito cuando la fecha límite deba ser la misma para todos.",
    example: `<div data-ol-countdown="2026-08-15T20:00-06:00">
  <span data-ol-cd="days">00</span> días
  <span data-ol-cd="hours">00</span> h
  <span data-ol-cd="mins">00</span> m
  <span data-ol-cd="secs">00</span> s
  <p data-ol-cd-ended style="display:none">¡La oferta terminó!</p>
</div>`,
  },
  status: "stable",
};
