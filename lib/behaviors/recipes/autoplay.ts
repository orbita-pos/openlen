import type { Behavior } from "../types";

// Esta conducta NO inventa un carrusel: se monta sobre el que YA existe y YA
// está en producción (lib/publish/carousel.ts). Ese archivo define el
// contrato — [data-ol-row] (wrapper que NO scrollea), las flechas
// [data-ol-scroll] FUERA del scroller, y [data-ol-scroller] (la pista
// overflow-x:auto) — y no se toca aquí. autoplay solo añade el avance
// automático sobre esa estructura ya sellada.
//
// LA DECISIÓN (Task 8 dejó la mitad hecha, esta receta cierra la otra
// mitad): matchesHost (validate.ts) camina ancestro-o-sí-mismo (closest())
// porque filter lo necesita así (su botón vive DENTRO de
// [data-ol-filter-group]). Efecto colateral: un [data-ol-autoplay] en un
// HIJO de [data-ol-row] valida limpio, no solo en el propio [data-ol-row].
// En vez de inventar vocabulario nuevo en el schema (requiresHostExact o
// similar) para forzar "mismo elemento", el runtime de ABAJO resuelve su
// host exactamente igual que el validador: `m.closest('[data-ol-row]')`. Así
// la validación por ancestro es EXACTAMENTE correcta y coherente con lo que
// el runtime hace de verdad — el marcador puede vivir en el row o en un
// descendiente suyo, y en ambos casos encuentra el row correcto (ver
// autoplay.test.ts, "el invariante closest()"). Ver también el comentario
// del campo `requiresHost` en types.ts, que documenta este invariante para
// la próxima receta que lo use.
//
// Nombres de una letra (m=marcador, r=row, s=scroller, o=over/hover, k=el
// stop): mismo estilo denso que countdown/filter/lightbox — `r` en
// particular hace eco a propósito del `r` de countdown.ts (el elemento raíz
// por instancia).
//
// document.querySelectorAll(...).forEach(function(m){...}) en vez del
// `for(var i=0;i<L.length;i++)(function(r){...})(L[i])` de countdown.ts:
// mismo resultado — cada carrusel vive en su propio closure (`r`, `s`, `o`,
// `iv` no se comparten entre instancias, el callback de forEach ES su propia
// función por llamada) — pero más corto. El presupuesto es por receta
// (700B) y este runtime instala 4 listeners (hover×2 + stop×2) que
// countdown no necesita, así que se ganó el byte donde se pudo sin tocar
// ningún comportamiento pedido.
//
// El gate de prefers-reduced-motion se evalúa UNA VEZ, fuera del loop —es
// una preferencia del SISTEMA OPERATIVO del visitante, igual para todos los
// carruseles de la página, no por-instancia— y si aplica, NINGÚN autoplay se
// instala en absoluto (ni siquiera se recorren los marcadores). No es
// opcional: es la preferencia de accesibilidad más explícita que existe.
//
// El hover (o) se cablea con r.onmouseenter=/r.onmouseleave= (propiedad), NO
// addEventListener: a diferencia de filter/lightbox/copy (un solo listener
// delegado en `document` para TODA la página), aquí cada carrusel necesita
// su propio listener sobre SU `r` — no hay nada que delegar ni riesgo de
// pisar un handler ajeno (OpenLen borra todo el JS del creador; nadie más
// escribe en r.onXxx). La propiedad es más corta que addEventListener y no
// toca `document`, así que no hace falta trackDocumentListeners() en el test
// por ESTA vía (el archivo lo llama de todos modos, por consistencia con el
// resto del catálogo — ver el comentario en autoplay.test.ts).
//
// GOTCHA REAL cazado escribiendo esta receta (no solo de test): el stop
// definitivo NO puede usar el mismo truco de propiedad para pointerdown.
// r.onpointerdown=... se ASIGNA sin error pero jsdom nunca lo invoca al
// dispatchear un evento "pointerdown" — Pointer Events es tan nuevo que
// jsdom (25.0.1, la versión de este repo) todavía no define la propiedad
// IDL onpointerdown en absoluto (tampoco el constructor PointerEvent),
// aunque SÍ soporta el evento por addEventListener (el mecanismo genérico
// no depende de que el motor "conozca" el nombre). Esto no rompería en un
// navegador real (todos implementan onpointerdown hace años), pero SÍ
// rompería el test — y peor, lo haría en SILENCIO: la asignación no truena,
// simplemente el handler nunca se ejecuta, así que solo se cazó al ver un
// test en rojo con 5 llamadas a scrollBy que "no debían" existir. Por eso
// pointerdown Y keydown usan addEventListener con un `k` compartido —
// onkeydown SÍ funciona como propiedad en jsdom (es una IDL antigua), pero
// usar el mismo mecanismo para ambos evita la asimetría y el riesgo de que
// el próximo evento "nuevo" que alguien añada aquí pise la misma piedra.
//
// El foco (:focus-within) NO lleva un listener propio — r.contains(
// document.activeElement) se relee en CADA tick, así que no hace falta
// sincronizar un tercer booleano con focusin/focusout; siempre está
// actualizado y sale más barato en bytes. olEditing()||o||r.contains(...) en
// un solo if: olEditing() se evalúa PRIMERO por el cortocircuito de `||`
// (antes de leer o/foco — "antes de tocar nada"), exactamente igual que si
// fueran dos if separados, pero sin repetir `return`.
//
// El stop definitivo (k) hace clearInterval(iv) — no un booleano `stopped`
// que tick() comprobara y siguiera dejando el setInterval vivo para
// siempre. Ya nos mordió una vez (countdown, Task 9): un intervalo que
// nunca se limpia sigue corriendo en una pestaña que el visitante puede
// dejar abierta horas. Aquí además NUNCA vuelve a arrancar (permanente, a
// propósito — WCAG 2.2.2): en cuanto el visitante interactúa, se acabó, ni
// siquiera si luego quita el puntero (ver el test correspondiente).
//
// El wraparound reutiliza el ÚNICO sink (scrollBy) con un `left` de signo
// distinto en vez de traer scrollTo aparte: -s.scrollLeft, sumado a la
// posición actual, aterriza exacto en 0. Un sink menos que aprender/probar.
// El piso de 240px (Math.max) replica el mismo mínimo que ya usan las
// flechas manuales en carousel.ts — mismo criterio visual en automático y
// en manual, y protege un carrusel angosto de un avance casi-cero.
//
// `+m.getAttribute(...)` en vez de parseInt(...,10): mismo criterio de
// número que usa validate.ts (Number(raw) + Number.isInteger) — un valor con
// basura al final ("1500ms", que validate.ts YA rechaza) no se acepta a
// medias aquí tampoco. if(!s||!ms) es la misma filosofía que `if(!t)return`
// en filter: el validador es una capa, no la única: si algo se cuela sin
// [data-ol-scroller] o con un ms inválido (0/NaN), el runtime se apaga en
// silencio — ni instala un setInterval en modo runaway, ni truena.
const JS = `var q=window.matchMedia;if(q&&q('(prefers-reduced-motion: reduce)').matches)return;document.querySelectorAll('[data-ol-autoplay]').forEach(function(m){var r=m.closest('[data-ol-row]'),s=r&&r.querySelector('[data-ol-scroller]'),ms=+m.getAttribute('data-ol-autoplay');if(!s||!ms)return;var o=0;r.onmouseenter=function(){o=1};r.onmouseleave=function(){o=0};var iv=setInterval(tick,ms);function k(){clearInterval(iv)}r.addEventListener('pointerdown',k);r.addEventListener('keydown',k);function tick(){if(olEditing()||o||r.contains(document.activeElement))return;s.scrollBy({left:s.scrollLeft+s.clientWidth>=s.scrollWidth?-s.scrollLeft:Math.max(240,Math.round(s.clientWidth*.8)),behavior:'smooth'})}});`;

export const autoplay: Behavior = {
  name: "autoplay",
  marker: "data-ol-autoplay",
  schema: {
    root: { kind: "ms", min: 1500 },
    // "[data-ol-row]" — la estructura del carrusel YA desplegado
    // (lib/publish/carousel.ts), no una conducta de este registro. El
    // marcador puede vivir en el row o en un descendiente suyo: ver el
    // comentario largo arriba y el de `requiresHost` en types.ts.
    requiresHost: "[data-ol-row]",
    parts: [{ selector: "[data-ol-scroller]", min: 1, why: "el autoplay necesita la pista scrollable del carrusel" }],
  },
  js: JS,
  budgetBytes: 700,
  docBudgetChars: 1200,
  // Sin runtime, carousel.ts ya cablea las flechas y el scroller acepta
  // swipe/wheel nativo — el visitante pierde el avance automático, nada
  // más. No hay nada que este runtime posea que no exista ya sin él.
  degradation: "content-intact",
  // El ARIA de las flechas (aria-label) ya lo lleva el markup del carrusel
  // (carousel.ts); esta receta no crea ningún elemento nuevo que necesite
  // declarar su propio requisito de accesibilidad aquí.
  a11y: [],
  doc: {
    when: "Un carrusel de fotos, platillos, testimonios o productos que quieres que avance solo para darle vida a la página sin que el visitante tenga que tocar nada — el menú de una taquería, una galería de trabajos, un carrusel de reseñas.",
    whenNot: "No lo actives sobre un carrusel con pocas tarjetas que ya se ven completas sin scroll — avanzar solo no aporta nada ahí y solo compite por la atención del visitante. El marcador va sobre [data-ol-row] o un descendiente suyo (nunca fuera de esa estructura), y el intervalo nunca baja de 1.5s: menos que eso es mareante.",
    example: `<div data-ol-row data-ol-autoplay="5000" class="relative">
  <button data-ol-scroll="prev" aria-label="Anterior">‹</button>
  <button data-ol-scroll="next" aria-label="Siguiente">›</button>
  <div data-ol-scroller class="overflow-x-auto flex gap-4 snap-x">
    <article class="snap-start">Plato 1</article>
    <article class="snap-start">Plato 2</article>
    <article class="snap-start">Plato 3</article>
  </div>
</div>`,
  },
  status: "stable",
};
