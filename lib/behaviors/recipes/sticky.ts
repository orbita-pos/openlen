import type { Behavior } from "../types";

// El runtime MÁS CORTO del catálogo — apenas conmuta un atributo; la
// decisión de diseño (qué aspecto tiene [data-ol-stuck]) la toma la IA en
// CSS, no este motor (ver el comentario de `css: ninguno` más abajo). `n` se
// resuelve UNA VEZ al arrancar, no en cada scroll: el contrato es "un
// <nav>" (doc.example trae exactamente uno) — a diferencia de countdown o
// autoplay, que recorren TODOS los marcadores de la página con un loop, aquí
// no hace falta: solo existe una barra de navegación fija por página.
//
// window, no document: `scroll` en window es el scroll DE LA PÁGINA (lo que
// visualmente separa al nav del contenido que pasa debajo). Delegar en
// `document` (como hacen filter/lightbox/copy/theme con `click`) no aplica
// aquí — delegación sirve para no poner N listeners sobre N elementos que
// disparan el MISMO tipo de evento; scroll de página es un evento único y
// global, no hay nada que delegar.
//
// {passive:true}: un listener de scroll NO pasivo obliga al navegador a
// esperar a que el handler termine antes de pintar el siguiente frame de
// scroll — degrada el scroll de TODA la página, no solo el del nav, incluso
// si el handler nunca llama preventDefault (este no lo hace). Declarar la
// intención por adelantado deja al hilo de composición seguir sin
// bloquearse.
//
// Throttle con requestAnimationFrame, no con un debounce de setTimeout: el
// evento scroll dispara cientos de veces por segundo — escribir el DOM en
// cada uno es trabajo desperdiciado que el navegador como mucho va a
// repintar una vez por frame de todos modos. `t` es el guard de "ya hay un
// frame pendiente": el PRIMER scroll de una ráfaga agenda `u` vía rAF y pone
// t=1; los siguientes scrolls de la MISMA ráfaga ven t=1 y no agendan nada
// más; cuando el frame llega, `u` corre UNA sola vez, lee el scrollY más
// reciente (no el del primer evento de la ráfaga — rAF corre después de
// todos los scrolls acumulados de ese frame) y vuelve a poner t=0 para la
// próxima ráfaga.
//
// t=0 es LO PRIMERO que hace `u`, ANTES del guard de edición — a propósito,
// y al revés de como uno esperaría leer "olEditing() antes de tocar nada":
// si el reset viviera DESPUÉS del `return` de olEditing(), un solo scroll
// disparado mientras el creador edita dejaría `t` en 1 PARA SIEMPRE (nada
// vuelve a ponerlo en 0), y el listener de scroll (`if(t)return`) jamás
// volvería a agendar un frame — ni siquiera después de que la edición
// termine, porque el listener sigue vivo toda la vida de la página. "Antes
// de tocar nada" se refiere al DOM público (el atributo del nav): resetear
// `t` no es una mutación observable desde fuera de esta receta, así que no
// rompe la promesa del guard, y dejarlo después SÍ rompería el throttle para
// siempre por un efecto colateral que nada tiene que ver con edición.
//
// Se aplica una vez al arrancar (la línea final, `u()`, fuera de cualquier
// listener) para que una página que carga ya scrolleada (el visitante entra
// por un #ancla a media página, o el navegador restaura la posición de
// scroll al recargar) nazca con el estado correcto sin esperar al primer
// evento de scroll — que podría no llegar nunca si el visitante no vuelve a
// mover la rueda.
//
// Por qué JS y no CSS puro: `animation-timeline: scroll()` resolvería esto
// sin una sola línea de JS, pero Firefox no lo soporta (ni detrás de un
// flag, a la fecha) — y OpenLen no puede publicar una página que se ve rota
// para un tercio de los visitantes de escritorio. Seis líneas de JS con
// degradación content-intact (el nav sin runtime se queda en su estado
// inicial, que ya es perfectamente usable) es la opción que funciona en
// todos lados.
const JS =
  `var n=document.querySelector('[data-ol-sticky]');if(!n)return;var t=0;function u(){t=0;if(olEditing())return;n.toggleAttribute('data-ol-stuck',window.scrollY>24)}window.addEventListener('scroll',function(){if(t)return;t=1;requestAnimationFrame(u)},{passive:true});u();`;

export const sticky: Behavior = {
  name: "sticky",
  marker: "data-ol-sticky",
  schema: {
    root: { kind: "flag" },
  },
  js: JS,
  budgetBytes: 700,
  docBudgetChars: 1200,
  // El nav sin runtime se queda en su estado inicial (el que la IA le dio en
  // `class`) — ya es un nav perfectamente usable, solo no gana el aspecto
  // "sólido" al bajar. Nada se pierde, es pura mejora progresiva: por eso
  // content-intact y no control-inert (el nav no es un control, es
  // navegación — y navega igual de bien con o sin el atributo).
  degradation: "content-intact",
  // No añade elementos ni roles nuevos: solo conmuta un atributo sobre un
  // <nav> que la IA ya escribió con su propia semántica y sus propios
  // enlaces — nada que declarar aquí.
  a11y: [],
  // SIN `css`: el aspecto de [data-ol-stuck] (fondo sólido, sombra, tamaño
  // más compacto, lo que sea) es una decisión de DISEÑO — depende de la
  // paleta y la tipografía de CADA página — no del motor. El motor solo
  // garantiza que el atributo esté puesto en el momento correcto; qué CSS
  // reacciona a él lo autora la IA junto al resto del markup. Inventar un
  // estilo por defecto aquí sería imponer un diseño que no le toca decidir a
  // esta capa (mismo argumento que ya usa theme.ts: el motor termina en el
  // atributo/clase, nunca en el look).
  doc: {
    when: "Un <nav> fijo (position:fixed o sticky) que arranca transparente o mezclado con el hero, y que necesita ganar fondo sólido, sombra o un tamaño más compacto en cuanto el visitante empieza a bajar — para seguir siendo legible sobre cualquier contenido que pase debajo.",
    whenNot: "No lo actives sobre un nav que YA nace sólido (fondo opaco desde el primer pixel): no hay nada que ganar al bajar, el atributo se pondría pero ningún CSS lo estaría esperando. Y recuerda: el marcador por sí solo NO CAMBIA NADA VISUAL — el estilo de [data-ol-stuck] hay que escribirlo a mano (Tailwind o CSS propio) junto al nav; sin esa clase, esta receta conmuta un atributo que nadie mira.",
    example: `<nav data-ol-sticky class="fixed top-0 w-full transition-colors">
  <a href="/">Mi negocio</a>
  <a href="/menu">Menú</a>
</nav>`,
  },
  status: "stable",
};
