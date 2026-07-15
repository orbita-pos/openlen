import type { Behavior } from "../types";

// La 8ª conducta (spec de interactividad, la #1 por demanda medida en el
// catálogo: .tab-btn/install-tab/day-tab/wktab aparecían en varias plantillas
// muertas). Estructura espejo de filter (grupo de botones + contenedor de
// destino SEPARADO, no anidado):
//   [data-ol-tabs="g"]        — el grupo de botones
//     [data-ol-tab="panelA"]  — cada botón (marcador); su valor = nombre del panel
//   [data-ol-tab-panels="g"]  — el contenedor de paneles (mismo nombre "g")
//     [data-ol-tab-panel="panelA"] — cada panel
//
// CONTENT-INTACT por "ready-gate": el CSS solo oculta paneles cuando el
// runtime marcó el contenedor con data-ol-tab-ready. Sin runtime (kill-switch,
// JS bloqueado, error) NINGÚN panel se oculta → se ven TODOS, apilados: el
// contenido nunca se pierde, solo deja de estar en pestañas. Es la única forma
// honesta de hacer tabs sin romper la promesa de este sistema.
//
// El runtime, al montar, marca el contenedor ready y activa el PRIMER panel de
// cada grupo. Al hacer click en una pestaña, activa su panel y desactiva los
// hermanos. Delegado en document (un solo listener, como filter/lightbox/copy),
// más un barrido de init (como sticky). olEditing() primero en el click: en el
// preview el creador puede estar editando el texto de un panel y un cambio de
// pestaña le movería el contenido bajo el cursor.
//
// GUARDA anti-blanqueo: si la pestaña clicada NO tiene panel pareja (autoría
// incompleta que el validador no cazó), el runtime NO hace nada — jamás deja
// el contenedor sin ningún panel activo (que con el CSS = todo oculto). Mismo
// espíritu que el `if(!t)return` de filter: el validador es una capa, no la
// única. querySelector envuelto en try/catch porque el nombre del grupo/panel
// es valor de autor y podría romper el selector (mismo contrato que filter).
const JS = `function Q(pc,v){try{return pc.querySelector('[data-ol-tab-panel="'+v+'"]')}catch{}}function A(g,pc,b){var t=g.querySelectorAll('[data-ol-tab]');for(var i=0;i<t.length;i++)t[i].setAttribute('aria-selected',t[i]===b);var p=pc.querySelectorAll('[data-ol-tab-panel]'),w=Q(pc,b.getAttribute('data-ol-tab'));for(var j=0;j<p.length;j++)p[j].toggleAttribute('data-ol-tab-active',p[j]===w)}function P(g){try{return document.querySelector('[data-ol-tab-panels="'+g.getAttribute('data-ol-tabs')+'"]')}catch{}}document.querySelectorAll('[data-ol-tabs]').forEach(function(g){var t=g.querySelectorAll('[data-ol-tab]'),pc=P(g);if(!pc||!t.length)return;pc.setAttribute('data-ol-tab-ready','');A(g,pc,t[0])});document.addEventListener('click',function(e){if(olEditing())return;var b=e.target.closest('[data-ol-tab]');if(!b)return;var g=b.closest('[data-ol-tabs]');if(!g)return;var pc=P(g);if(!pc||!Q(pc,b.getAttribute('data-ol-tab')))return;A(g,pc,b)});`;

// El ready-gate: sin data-ol-tab-ready (sin runtime) esta regla no matchea
// nada y todos los paneles se ven. Con runtime, solo el activo. !important
// por el mismo motivo que filter: un panel con display:flex/grid de Tailwind
// le ganaría a un display:none sin él.
const CSS = `[data-ol-tab-panels][data-ol-tab-ready] [data-ol-tab-panel]:not([data-ol-tab-active]){display:none!important}`;

export const tabs: Behavior = {
  name: "tabs",
  marker: "data-ol-tab",
  schema: {
    root: { kind: "flag" },
    // El botón vive DENTRO del grupo (como filter dentro de filter-group);
    // matchesHost en validate.ts camina ancestros.
    requiresHost: "[data-ol-tabs]",
    // El grupo debe apuntar a un contenedor de paneles que EXISTA — sin él
    // los botones no tienen qué mostrar (misma mitad que filter: grupo ↔
    // target). El pareo por-pestaña (cada data-ol-tab ↔ su data-ol-tab-panel)
    // lo cubre la GUARDA anti-blanqueo del runtime, no el validador.
    crossRefs: [{
      via: "data-ol-tabs",
      target: "data-ol-tab-panels",
      why: "sin ese contenedor de paneles, las pestañas no muestran nada",
    }],
  },
  js: JS,
  css: CSS,
  // data-ol-tab-ready (contenedor) y data-ol-tab-active (panel) son estado
  // PURO del runtime — el strip los borra incondicionalmente (categoría A).
  // aria-selected NO va aquí: puede ser valor autorado legítimo (la IA marca
  // aria-selected="true" en la 1ª pestaña del ejemplo), así que se restaura
  // desde el stash (categoría B, como el aria-pressed de filter). Ver el test
  // de colisión de namespace en conformance.test.ts.
  // La receta más pesada del catálogo (init + click delegado + 3 helpers +
  // guarda anti-blanqueo): 937B. El techo global compuesto (6144B en
  // build.ts) lo absorbe con holgura. 950 deja el margen honesto que la
  // próxima receta también tendrá que respetar.
  runtimeAttrs: ["data-ol-tab-ready", "data-ol-tab-active"],
  budgetBytes: 950,
  docBudgetChars: 1200,
  degradation: "content-intact",
  a11y: [{ selector: ":root", attr: "aria-selected" }],
  doc: {
    label: "pestañas",
    when: "Un bloque de contenido que se agrupa en secciones alternativas donde el visitante elige cuál ver con un click, sin recargar — instrucciones de instalación (npm/pnpm/yarn), planes mensual/anual, especificaciones por variante de producto, un FAQ por categoría.",
    whenNot: "No lo uses para contenido que el visitante debería leer completo y en orden (un artículo, una lista de pasos): las pestañas esconden todo menos una, y sin JS se apilan todas. Cada botón [data-ol-tab] va dentro de [data-ol-tabs] y su valor debe existir como [data-ol-tab-panel] dentro del [data-ol-tab-panels] del mismo nombre; sin esa pareja, la pestaña no muestra nada.",
    example: `<div data-ol-tabs="instalar" role="tablist">
  <button data-ol-tab="npm" role="tab" aria-selected="true">npm</button>
  <button data-ol-tab="pnpm" role="tab" aria-selected="false">pnpm</button>
</div>
<div data-ol-tab-panels="instalar">
  <pre data-ol-tab-panel="npm" role="tabpanel">npm i openlen</pre>
  <pre data-ol-tab-panel="pnpm" role="tabpanel">pnpm add openlen</pre>
</div>`,
  },
  status: "stable",
};
