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
//     [data-ol-set="x = fórm"]  — al hacer clic, asigna (varias con `;`)
//   [data-ol-state="n = 0"]     — el estado con el que la región NACE
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
//
// Se SIEMBRA al montar desde `data-ol-state-c`, que la ingestión dejó con los
// valores ya evaluados (no programas: son valores iniciales, no fórmulas
// vivas). Eso es lo que desbloquea acumuladores, tableros y turnos — sin un
// valor inicial, un `data-ol-set` que lee su propio destino queda bloqueado
// por `U()` para siempre.
//
// Dentro de un mismo gesto las asignaciones se ven entre sí, EN ORDEN: en
// `c1 = turno; turno = SI(...)`, la segunda ya no puede leer el valor viejo si
// la primera lo cambió. Por eso `o` se actualiza junto con `s`.
const WIRING = `function J(s){try{return JSON.parse(s)}catch(e){}}
function S(r,a){return r.querySelectorAll('['+a+']')}
function C(e,s){return e.target.closest&&e.target.closest(s)}
function E(r){var o={},q=S(r,'data-ol-val'),i,e,n,l;for(i=0;i<q.length;i++){e=q[i];n=e.getAttribute('data-ol-val');if(e.type=='radio'){if(e.checked)o[n]=e.value;else if(!(n in o))o[n]='';continue}l=S(e,'data-ol-item');o[n]=l.length?[].map.call(l,function(x){return x.textContent.trim()}):e.type=='checkbox'?e.checked:e.value!==undefined?e.value:e.textContent.trim()}for(n in r.olS||{})o[n]=r.olS[n];return o}
function U(p,o){for(var i=0,c;i<p.length;i++){c=p[i];if(typeof c=='string'&&c.charAt(0)=='$'&&!(c.slice(1)in o))return 1}}
function R(r){var o=E(r),A=['data-ol-out-c','data-ol-if-c'],f,a,q,i,p;for(f=0;f<2;f++){a=A[f];q=S(r,a);for(i=0;i<q.length;i++){p=J(q[i].getAttribute(a));if(!p||U(p,o))continue;if(f)q[i].toggleAttribute('data-ol-calc-off',!olX(p,o));else q[i].textContent=olX(p,o)}}}
function W(e){var r=C(e,'[data-ol-calc]');if(r&&!olEditing())R(r)}
['input','change'].forEach(function(t){document.addEventListener(t,W)});
document.addEventListener('click',function(e){if(olEditing())return;var b=C(e,'[data-ol-set-c]');if(!b)return;var r=b.closest('[data-ol-calc]'),a=J(b.getAttribute('data-ol-set-c'));if(!r||!a)return;var o=E(r),s=r.olS=r.olS||{},z;for(z=0;z<a.length;z++){if(U(a[z].p,o))continue;s[a[z].n]=olX(a[z].p,o);o[a[z].n]=s[a[z].n]}R(r)});
S(document,'data-ol-calc').forEach(function(r){r.olS=J(r.getAttribute('data-ol-state-c'))||{};R(r)});`;

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
    fingerprint: {
      rootAttrs: ["data-ol-state"],
      descendants: [
        { selector: "[data-ol-val]", attrs: ["data-ol-val", "type", "value", "checked"], text: true },
        { selector: "[data-ol-val] option", attrs: ["value", "selected"], text: true },
        { selector: "[data-ol-item]", text: true },
      ],
    },
  },
  js: JS,
  css: CSS,
  // Estado PURO del runtime — el strip lo borra sin preguntar (categoría A).
  // El TEXTO de [data-ol-out] NO va aquí: es contenido, y se restaura desde el
  // stash del preview (categoría B, como el de countdown).
  runtimeAttrs: ["data-ol-calc-off"],
  // 4,203B MEDIDOS (no estimados) — la excepción más grande del catálogo, y la
  // razón por la que se concede: esto no es una receta, es un INTÉRPRETE.
  //   2,667B  la máquina de pila (lib/expr/machine.test.ts la afirma aparte,
  //           para que no crezca en silencio)
  //   1,536B  el cableado del DOM
  //
  // 3,650 → 4,203 al añadir L3: listas por posición (ELEMENTO/POSICION), las
  // cuatro comprensiones acotadas, el estado declarado y las asignaciones
  // múltiples, más las listas escritas a mano. 606 bytes por la diferencia entre "una calculadora" y
  // "cualquier cosa que se pueda preguntar sobre una lista".
  //
  // Qué compra: las 19 formas de la tabla del plan MÁS quizzes multi-paso,
  // tableros, turnos, acumuladores y carritos con listas paralelas — de UNA
  // implementación. La alternativa (recetas sueltas de calculadora, sorteo,
  // quiz, interruptor y carrito) serían 5 x 700 = 3,500B **y seguirían sin
  // cubrir lo que nadie ha pedido todavía**.
  //
  // Y no lo paga ninguna página que no calcule: present() (build.ts:29) sólo
  // compone las recetas cuyo marcador está de verdad en el documento.
  //
  // 4,300 deja ~97B de margen, el mismo orden que el que tabs se dejó (937 de
  // 950). Si el intérprete crece, se ve.
  budgetBytes: 4300,
  // 1.200 → 2.000, y es el ÚNICO de los tres techos de esta receta que puede
  // hacer daño fuera de ella: la sección CONDUCTAS ya es el 45% del prompt de
  // crear, y lo pagan TODAS las generaciones, calculen o no. Por eso este
  // número no se sube y ya — se sube y se MIDE con `npm run evals:pages`
  // contra lib/evals/baseline.json.
  //
  // Qué compra los 800 caracteres: cuatro piezas nuevas que sin enseñarse no
  // existen (el modelo no las va a adivinar), y la regla del "un solo control
  // por nombre" — que no es cosmética: la primera eval con briefs de cálculo
  // pilló al modelo emitiendo un campo Y un deslizador para el mismo dato, con
  // el deslizador naciendo muerto.
  docBudgetChars: 2000,
  degradation: "content-intact",
  // Un número que cambia sin recargar hay que anunciarlo.
  a11y: [{ selector: "[data-ol-out]", attr: "aria-live" }],
  doc: {
    label: "cálculo en vivo",
    when: "El visitante escribe, elige o hace clic y la página responde al instante con un número, un texto o un bloque que aparece: cotizadores, presupuestos, calculadoras, quizzes, sorteos, comparadores, contadores, juegos sencillos. Funciones: SUMA MIN MAX REDONDEA CUENTA SI AZAR TEXTO UNE MONEDA LISTA ELEMENTO POSICION TODOS ALGUNO CUENTA_SI FILTRA. Operadores + - * / % = != < <= > >= Y O NO. ELEMENTO(lista, 2) es el segundo (el primero es 1); POSICION(lista, valor) dice su lugar; dos listas ALINEADAS arman un catálogo — prefiérelo a encadenar SI. LISTA(45,55) es una lista a mano. TODOS/ALGUNO/CUENTA_SI/FILTRA recorren una lista; dentro, CADA es el elemento: CUENTA_SI(respuestas, CADA = 'sí').",
    whenNot: "No lo uses para nada que deba guardarse o enviarse (formulario, reserva, pedido): eso es un módulo — la página piensa, no recuerda. Tampoco para texto fijo. REGLAS: el [data-ol-calc] va en un contenedor que ENVUELVA los campos y los resultados, nunca en el botón — todo data-ol-out/-if/-set debe quedar dentro. UN SOLO control por nombre: nunca un campo Y un deslizador para el mismo dato, el segundo nacería muerto. Todo data-ol-val debe leerlo alguna fórmula, y todo nombre que una fórmula lea debe existir como data-ol-val o en data-ol-state (varias, separadas por coma). CADA sólo existe dentro de TODOS/ALGUNO/CUENTA_SI/FILTRA. Si algo falla, no se publica.",
    example: `<div data-ol-calc data-ol-state="visto = 1">
  <input data-ol-val="recibo" type="number" value="1800">
  <p>Ahorras <strong data-ol-out="MONEDA(recibo * 0.72, 0)" aria-live="polite">1,296</strong> al mes</p>
  <p data-ol-if="recibo > 3000">Te conviene el plan grande.</p>
  <ul data-ol-val="planes"><li data-ol-item>Básico</li><li data-ol-item>Pro</li></ul>
  <ul data-ol-val="precios"><li data-ol-item>99</li><li data-ol-item>199</li></ul>
  <p data-ol-out="UNE(ELEMENTO(planes, visto), ': ', MONEDA(ELEMENTO(precios, visto), 0))">Básico: 99</p>
  <button data-ol-set="visto = SI(visto = 1, 2, 1)">Ver el otro</button>
</div>`,
  },
  status: "stable",
};
