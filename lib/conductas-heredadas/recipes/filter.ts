import type { Behavior } from "../types";

// Delegado en document (un solo listener, como lightbox) — sube del botón
// pulsado a SU grupo, resuelve el destino por NOMBRE. Eso es lo que deja a
// dos rejillas de filtro independientes en la misma página sin pisarse: cada
// click resuelve su propio [data-ol-filter-group] y su propio
// [data-ol-filter-target], nunca toca el ajeno.
//
// data-ol-filtered, NO `hidden` nativo: un item con display:flex de Tailwind
// le gana al display:none del user-agent para [hidden], y el filtro
// "funcionaría" sin ocultar nada. Por eso trae su propio atributo + su propio
// CSS con !important (abajo).
//
// NO data-ol-hidden (nombre usado hasta el bug CRITICAL de la revisión final
// de rama): ese nombre YA es de use-element-inspect.ts's applyHide(), la
// acción deliberada del creador "Ocultar elemento" — persistida a propósito
// en el HTML guardado. El funnel de guardado (strip-editor-instrumentation.ts)
// trata el atributo de ESTA receta como "sin dueño legítimo fuera del
// runtime" y lo borra incondicionalmente en cada guardado; con el nombre
// compartido, cualquier elemento que el creador hubiera ocultado a propósito
// se des-ocultaba en el primer guardado tras publicarse esta receta. El
// nombre nuevo (`data-ol-filtered`) no colisiona con nada — ver `runtimeAttrs`
// abajo y el test de colisión de namespace en conformance.test.ts.
//
// data-ol-tag admite varias etiquetas separadas por espacio ("tacos
// vegano"); se matchea con split(' ').indexOf(valor). '*' se compara ANTES
// del split — mostrar todo no necesita mirar la etiqueta de nadie.
// Dos coerciones implícitas hacen el loop más corto y no son evidentes al
// leerlas frío: toggleAttribute(name, force) castea `force` a booleano (así
// que `v!=='*'&&!~tg.indexOf(v)` sirve directo, sin if/else ni una segunda
// aparición del string 'data-ol-filtered'); setAttribute(name, value) castea
// `value` a string (así que pasar el booleano `bs[j]===b` ya produce
// "true"/"false" sin ternario). `~tg.indexOf(v)` es 0 (falsy) solo cuando
// indexOf da -1. El `||''` de getAttribute('data-ol-tag') no hace falta: el
// selector que produjo `el` ya garantiza que el atributo existe. `F` deduplica
// el selector `[data-ol-filter]`, usado dos veces (el botón pulsado y el
// resto de botones del grupo). Sin el `&&` defensivo de lightbox antes de
// `.closest`: aquí `e.target` es SIEMPRE el objetivo de un click real
// (delegado en document), nunca algo sin prototipo de Element.
// t=…querySelector wrapped in try/catch: `n` is data-ol-filter-group's VALUE,
// a host attribute the validator never schema-checks (only the marker's own
// value is). A creator/AI value like `x"]),[data-ol-tag` turns the
// constructed `[data-ol-filter-target="…"]` string into an invalid selector,
// and querySelector throws SyntaxError, uncaught, mid-listener — same
// try/catch contract theme.ts/copy.ts already honor for their own fallible
// calls. Degrades to `t` staying undefined, so `if(!t)return` still applies.
const JS = `document.addEventListener('click',function(e){if(olEditing())return;var F='[data-ol-filter]';var b=e.target.closest(F);if(!b)return;var g=b.closest('[data-ol-filter-group]');if(!g)return;var n=g.getAttribute('data-ol-filter-group'),t;try{t=document.querySelector('[data-ol-filter-target="'+n+'"]')}catch{}if(!t)return;var v=b.getAttribute('data-ol-filter');var el=t.querySelectorAll('[data-ol-tag]');for(var i=0;i<el.length;i++){var x=el[i],tg=x.getAttribute('data-ol-tag').split(' ');x.toggleAttribute('data-ol-filtered',v!=='*'&&!~tg.indexOf(v))}var bs=g.querySelectorAll(F);for(var j=0;j<bs.length;j++)bs[j].setAttribute('aria-pressed',bs[j]===b)});`;

const CSS = `[data-ol-filtered]{display:none!important}`;

export const filter: Behavior = {
  name: "filter",
  marker: "data-ol-filter",
  schema: {
    root: { kind: "tagList" },
    // El botón debe vivir DENTRO de un grupo, no llevar el atributo él mismo
    // (a diferencia de autoplay, que SÍ coexiste con [data-ol-row] en el
    // mismo elemento) — matchesHost en validate.ts camina ancestros para
    // cubrir ambos casos. Fuera del grupo no hay de dónde leer el nombre: el
    // runtime se calla en vez de tronar.
    requiresHost: "[data-ol-filter-group]",
    // La otra mitad del cableado (hallazgo Fable, 2026-07-13): el grupo debe
    // apuntar a una rejilla que EXISTA — sin ella, el runtime hace
    // `if(!t)return` y todos los botones nacen muertos en silencio. Es el
    // ejemplo literal de la cabecera de validate.ts, que hasta este campo no
    // se cazaba. Ver el comentario de `crossRefs` en types.ts.
    crossRefs: [{
      via: "data-ol-filter-group",
      target: "data-ol-filter-target",
      why: "sin esa rejilla, los botones no filtran nada",
      targetParts: [{ selector: "[data-ol-tag]", attrs: ["data-ol-tag"] }],
    }],
  },
  js: JS,
  css: CSS,
  // Ver el comentario largo arriba (bug CRITICAL, revisión final de rama):
  // este es el único atributo que el runtime de ESTA receta posee.
  runtimeAttrs: ["data-ol-filtered"],
  budgetBytes: 700,
  docBudgetChars: 1200,
  degradation: "content-intact",
  a11y: [{ selector: ":root", attr: "aria-pressed" }],
  doc: {
    label: "filtro",
    when: "Una colección homogénea de tarjetas (menú, catálogo, portafolio) que el visitante quiere acotar por categoría con un click, sin recargar la página — el 'Todo / Tacos / Bebidas' de un menú de taquería.",
    whenNot: "No lo uses para alternar bloques de página no relacionados (hero, footer): es para acotar UNA colección por etiqueta, no para esconder secciones sueltas. Y el botón debe vivir dentro de [data-ol-filter-group] — fuera de él no hace nada.",
    example: `<div data-ol-filter-group="menu">
  <button data-ol-filter="*" aria-pressed="true">Todo</button>
  <button data-ol-filter="tacos" aria-pressed="false">Tacos</button>
  <button data-ol-filter="bebidas" aria-pressed="false">Bebidas</button>
</div>
<div data-ol-filter-target="menu">
  <article data-ol-tag="tacos">Tacos al pastor</article>
  <article data-ol-tag="bebidas">Agua de horchata</article>
  <article data-ol-tag="tacos vegano">Tacos de nopal</article>
</div>`,
  },
  status: "stable",
};
