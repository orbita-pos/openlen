import type { Behavior } from "../types";

// Progressive enhancement puro: es un <a href> a la foto grande. Sin runtime,
// el click abre la imagen — el contenido NUNCA se pierde. Mismo principio que
// las flechas del carrusel ("the buttons only enhance").
//
// El JS del brief (~696B) ya deja solo ~4B de margen bajo budgetBytes=700 —
// no los ~60B que el task asumía disponibles para foco. Para que el manejo de
// foco (tabIndex+focus al abrir, devolver foco al <a> al cerrar) quepa SIN
// tocar ninguna garantía de seguridad/UX, se unificó el cierre (click en
// backdrop + Escape) en un solo handler `h` — que de paso corrige una fuga: el
// código del brief solo hacía removeEventListener('keydown',k) en la rama
// Escape, así que cerrar por click en el backdrop dejaba el listener de
// keydown colgado en `document` para siempre (crece 1 por apertura). Ahorros
// de bytes: `dataset.olLbModal` en vez de `setAttribute('data-ol-lb-modal','')`
// (el marcador del MODAL es interno del runtime, no pasa por el validador —
// no confundir con `marker`, que sí es el atributo AUTORADO); alias local
// `d=document` (dentro del closure del click, no en el scope compartido de la
// IIFE compuesta — cero riesgo de colisión con otras recetas); y
// `ev.key&&ev.key!=='Escape'` en vez de comparar `ev.type` (los MouseEvent no
// tienen `.key`, así que distingue click de keydown sin guardar el tipo).
const JS = `document.addEventListener('click',function(e){if(olEditing())return;var a=e.target.closest&&e.target.closest('[data-ol-lightbox]');if(!a)return;var u=a.getAttribute('href')||'';if(!/^https?:\\/\\//i.test(u))return;e.preventDefault();var d=document;var m=d.createElement('div');m.dataset.olLbModal='';m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');var i=d.createElement('img');i.src=u;i.alt=(a.querySelector('img')||{}).alt||'';m.appendChild(i);var h=function(ev){if(ev.key&&ev.key!=='Escape')return;m.remove();d.removeEventListener('keydown',h);a.focus()};m.addEventListener('click',h);d.addEventListener('keydown',h);d.body.appendChild(m);m.tabIndex=-1;m.focus()});`;

const CSS = `[data-ol-lb-modal]{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.88);padding:4vmin;cursor:zoom-out}[data-ol-lb-modal] img{max-width:100%;max-height:100%;border-radius:10px}`;

export const lightbox: Behavior = {
  name: "lightbox",
  marker: "data-ol-lightbox",
  schema: {
    root: { kind: "flag" },
    // Sin href el <a> no abre NADA: se cae la promesa content-intact entera.
    // `untrusted` solo revalida el valor si el atributo está; `requiredAttrs`
    // exige que exista.
    requiredAttrs: ["href"],
    // El href acaba en un img.src en runtime: es entrada no confiable.
    untrusted: ["href"],
    parts: [{ selector: "img", min: 1, why: "el lightbox necesita una miniatura visible que abrir" }],
    fingerprint: {
      descendants: [{ selector: "img", attrs: ["alt"] }],
    },
  },
  js: JS,
  css: CSS,
  // El modal sintetizado carga este atributo — ver runtimeAttrs en types.ts
  // y el test de colisión de namespace en conformance.test.ts. El strip
  // (strip-editor-instrumentation.ts) borra el elemento ENTERO que lo lleva,
  // no solo el atributo (el modal no puede cerrarse fuera de la sesión que
  // lo creó), pero sigue siendo el mismo namespace a auditar.
  runtimeAttrs: ["data-ol-lb-modal"],
  budgetBytes: 700,
  docBudgetChars: 1200,
  degradation: "content-intact",
  // Los ARIA (role=dialog, aria-modal=true) los pone el runtime en el MODAL
  // que crea — el modal no existe en doc.example, así que no hay nada que
  // declarar aquí para que el arnés lo compruebe contra el ejemplo. Se prueba
  // en lightbox.test.ts, montando y verificando el DOM real tras el click.
  a11y: [],
  doc: {
    label: "lightbox",
    when: "Una galería de fotos donde el visitante quiere ver la imagen en grande sin salir de la página.",
    whenNot: "Nunca sobre un enlace de navegación: esto secuestra el click. Solo sobre <a> que apuntan a una IMAGEN.",
    example: `<a data-ol-lightbox href="https://images.openlen.com/plato-grande.jpg"><img src="https://images.openlen.com/plato-thumb.jpg" alt="Plato de tacos al pastor" class="rounded-xl"></a>`,
  },
  status: "stable",
};
