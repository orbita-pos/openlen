import { MACHINE_JS } from "@/lib/expr/machine";

import type { Behavior } from "../types";

// La 9ª conducta, y la única cuyo runtime es un INTÉRPRETE. Cierra L2 — "la
// página puede pensar; no puede recordar ni hablar con nadie".
//
// Estructura, una región con nombres propios:
//   [data-ol-calc]              — el marcador: la región
//     [data-ol-val="recibo"]    — lo que el visitante escribe o elige
//     [data-ol-out="fórmula"]   — el texto del elemento pasa a ser el resultado
//     [data-ol-if="fórmula"]    — visibilidad según una condición
//     [data-ol-set="x = fórm"]  — al hacer clic, asigna
//
// POR QUÉ UNA REGIÓN Y NO EL PROPIO ELEMENTO DE SALIDA. Una conducta tiene UN
// marcador (hasMarkerAttr, build.ts:56). Con el marcador en la salida, una
// página que sólo muestra u oculta —un comparador de planes, un horario que
// cambia con la fecha: ningún resultado que escribir— no recibiría el runtime.
// La región lo arregla, y de paso da ÁMBITO a los nombres: dos calculadoras en
// la misma página dejan de pisarse.
//
// LO QUE VIAJA EN EL ATRIBUTO YA ESTÁ COMPILADO. `lib/expr/document.ts` corre
// en la INGESTIÓN y escribe el gemelo `-c` (postfijo plano, JSON) al lado de la
// fórmula legible. Aquí no hay parser: hay una máquina de pila. Nunca `eval`,
// nunca `new Function`, y el hash del script entra en la CSP igual que el de
// las otras ocho.
//
// CONTENT-INTACT de verdad: el valor inicial lo escribe la ingestión DENTRO del
// elemento, así que sin runtime (kill-switch, JS bloqueado, CSP) la página
// sigue mostrando un número — no un hueco. Y `data-ol-calc-off` lo pone SÓLO el
// runtime, así que sin él no hay nada oculto (el patrón exacto de `filter`).
//
// LO QUE DEPENDE DE UN GESTO QUE AÚN NO OCURRIÓ no se calcula: `U()` barre el
// programa buscando un `$nombre` que no esté en el entorno. Es la MISMA regla
// que aplica la ingestión (`readsUnset`, document.ts) — sin ella la ruleta
// nacería diciendo "0" antes de girar, y al recargar (el navegador restaura los
// campos) el resultado se quedaría congelado en el valor de nacimiento.
//
// EL ESTADO DE LAS ASIGNACIONES vive en una propiedad JS del elemento
// (`r.olS`), nunca en un atributo: no se serializa, no hay nada que limpiar al
// guardar, y desaparece al recargar. La página piensa; no recuerda.
const WIRING = `function J(s){try{return JSON.parse(s)}catch(e){}}
function S(r,a){return r.querySelectorAll('['+a+']')}
function C(e,s){return e.target.closest&&e.target.closest(s)}
function E(r){var o={},q=S(r,'data-ol-val'),i,e,n,l;for(i=0;i<q.length;i++){e=q[i];n=e.getAttribute('data-ol-val');if(e.type=='radio'){if(e.checked)o[n]=e.value;else if(!(n in o))o[n]='';continue}l=S(e,'data-ol-item');o[n]=l.length?[].map.call(l,function(x){return x.textContent.trim()}):e.type=='checkbox'?e.checked:e.value!==undefined?e.value:e.textContent.trim()}for(n in r.olS||{})o[n]=r.olS[n];return o}
function U(p,o){for(var i=0,c;i<p.length;i++){c=p[i];if(typeof c=='string'&&c.charAt(0)=='$'&&!(c.slice(1)in o))return 1}}
function R(r){var o=E(r),A=['data-ol-out-c','data-ol-if-c'],f,a,q,i,p;for(f=0;f<2;f++){a=A[f];q=S(r,a);for(i=0;i<q.length;i++){p=J(q[i].getAttribute(a));if(!p||U(p,o))continue;if(f)q[i].toggleAttribute('data-ol-calc-off',!olX(p,o));else q[i].textContent=olX(p,o)}}}
function W(e){var r=C(e,'[data-ol-calc]');if(r&&!olEditing())R(r)}
['input','change'].forEach(function(t){document.addEventListener(t,W)});
document.addEventListener('click',function(e){if(olEditing())return;var b=C(e,'[data-ol-set-c]');if(!b)return;var r=b.closest('[data-ol-calc]'),a=J(b.getAttribute('data-ol-set-c'));if(!r||!a)return;var o=E(r);if(U(a.p,o))return;(r.olS=r.olS||{})[a.n]=olX(a.p,o);R(r)});
S(document,'data-ol-calc').forEach(function(r){R(r)});`;

const JS = `${MACHINE_JS}\n${WIRING}`;

// El patrón de `filter`: sin runtime nadie lleva el atributo, así que nada nace
// oculto y content-intact se sostiene COMPUTADO en jsdom, que es como el arnés
// lo exige. !important porque un display:flex/grid de Tailwind le ganaría.
const CSS = `[data-ol-calc-off]{display:none!important}`;

export const calc: Behavior = {
  name: "calc",
  marker: "data-ol-calc",
  schema: {
    root: { kind: "flag" },
    exprAttrs: {
      namesFrom: "data-ol-val",
      formulas: [
        { attr: "data-ol-out" },
        { attr: "data-ol-if" },
        { attr: "data-ol-set", assign: true },
      ],
    },
  },
  js: JS,
  css: CSS,
  // Estado PURO del runtime — el strip lo borra sin preguntar (categoría A).
  // El TEXTO de [data-ol-out] NO va aquí: es contenido, y se restaura desde el
  // stash del preview (categoría B, como el de countdown).
  runtimeAttrs: ["data-ol-calc-off"],
  // 3,650B MEDIDOS (no estimados) — la excepción más grande del catálogo, y la
  // razón por la que se concede: esto no es una receta, es un INTÉRPRETE. La
  // máquina de pila sola son 2,220B (lib/expr/machine.test.ts la afirma por
  // separado, para que no crezca en silencio) y el cableado del DOM los ~1,430
  // restantes. La proyección del plan eran ~3,150-3,350: se quedó corta, y el
  // número que manda es el medido.
  //
  // Qué compra: 19 de las 20 formas de petición de la tabla del plan, de UNA
  // implementación. La alternativa —recetas sueltas de calculadora, sorteo,
  // quiz e interruptor— serían 4 x 700 = 2,800B **y seguirían sin cubrir lo que
  // nadie ha pedido todavía**. Sale más barato y llega más lejos.
  //
  // Y no lo paga ninguna página que no calcule: present() (build.ts:29) sólo
  // compone las recetas cuyo marcador está de verdad en el documento — una
  // página con una calculadora y nada más recibe 3,994B, no los 9,3KB del peor
  // caso teórico.
  //
  // 3,700 deja 50B de margen: el mismo margen honesto que tabs se dejó (937 de
  // 950). Si el intérprete crece, se ve.
  budgetBytes: 3700,
  docBudgetChars: 1200,
  degradation: "content-intact",
  // Un número que cambia sin recargar hay que anunciarlo.
  a11y: [{ selector: "[data-ol-out]", attr: "aria-live" }],
  doc: {
    label: "cálculo en vivo",
    when: "El visitante escribe o elige algo y la página responde con un número, un texto o un bloque que aparece: cotizadores, presupuestos, calculadoras de ahorro, divisores de cuenta, quizzes, sorteos. Fórmulas: SUMA MIN MAX REDONDEA CUENTA SI AZAR TEXTO UNE MONEDA, operadores + - * / % = != < <= > >= Y O NO, y SOLO nombres declarados con data-ol-val en la MISMA región.",
    whenNot: "No lo uses para nada que deba guardarse o enviarse (formulario, reserva, pedido): eso es un módulo — la página piensa, no recuerda ni habla con nadie. Tampoco para texto fijo. Todo data-ol-out/-if/-set va DENTRO de un [data-ol-calc], y todo nombre que una fórmula lea debe existir como data-ol-val en esa región o ser destino de un data-ol-set; si no, no se publica.",
    example: `<div data-ol-calc>
  <input data-ol-val="recibo" type="number" value="1800">
  <p>Ahorras <strong data-ol-out="MONEDA(recibo * 0.72, 0)" aria-live="polite">1,296</strong> al mes</p>
  <p data-ol-if="recibo > 3000">Te conviene el plan grande.</p>
  <ul data-ol-val="nombres"><li data-ol-item>Ana</li><li data-ol-item>Luis</li></ul>
  <button data-ol-set="elegido = AZAR(nombres)">Sortear</button>
  <p data-ol-out="elegido">Aún nadie</p>
</div>`,
  },
  status: "stable",
};
