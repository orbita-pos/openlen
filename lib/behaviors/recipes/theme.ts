import type { Behavior } from "../types";

// Delegado en document (un solo listener, como copy/filter/lightbox) — sube
// del click hasta [data-ol-theme], nunca asume que e.target ES el botón. Sin
// el `&&` defensivo de lightbox antes de `.closest`: mismo argumento que
// filter/copy — e.target en un click real delegado en document SIEMPRE es un
// Element, nunca algo sin prototipo.
//
// El toggle y la persistencia viven en el MISMO try: "todo envuelto en
// try/catch" del contrato. classList.toggle('dark') va PRIMERO dentro del
// try — no porque el try lo proteja (un token de clase válido nunca lanza),
// sino porque así, si localStorage.setItem lanza justo después, la excepción
// ocurre DESPUÉS de que la clase ya se aplicó: el catch se come el error de
// persistencia sin deshacer el efecto visual. Es lo que hace honesto
// "la clase se aplica igual, solo no persiste" del test de localStorage roto.
// localStorage puede lanzar en modo privado de Safari o dentro de un iframe
// con almacenamiento restringido (el preview del editor es un caso real, no
// hipotético — mismo argumento que el fallback de copy.ts). catch{} sin
// binding: mismo estilo que copy.ts (execCommand), no hace falta inspeccionar
// el error, solo tragarlo.
//
// olEditing() primero, como todas las recetas: en el preview el creador
// puede tener el foco en el documento (tab Contenido); togglear .dark ahí le
// recalcularía todos los colores del lienzo a media edición.
const JS =
  `document.addEventListener('click',function(e){if(olEditing())return;var b=e.target.closest('[data-ol-theme]');if(!b)return;try{var k=document.documentElement.classList.toggle('dark');localStorage.setItem('ol-theme',k?'dark':'light')}catch{}});`;

// headJs: aparte de `js`, va al <head> (ver build.ts::buildBehaviorsHead +
// injectIntoHead). ESTA es la ÚNICA receta que lo usa, y por una sola razón:
// pre-paint. Si la preferencia se aplicara solo al final del <body> (como el
// resto del runtime), un visitante que ya eligió oscuro vería un fogonazo
// blanco (FOUC) en cada carga mientras el HTML claro pinta primero y el
// script del final del body corre después, uno o más frames más tarde.
// headJs corre ANTES de que el navegador pinte nada, así que <html
// class="dark"> ya está puesta cuando sale el primer pixel a pantalla.
// Nunca fusionar esto en `js` — perdería la propiedad que lo justifica (ver
// injectIntoHead: sin </head> el script NO se antepone al documento, para no
// meter al navegador en quirks mode).
const HEAD_JS =
  `try{if(localStorage.getItem('ol-theme')==='dark')document.documentElement.classList.add('dark')}catch{}`;

export const theme: Behavior = {
  name: "theme",
  marker: "data-ol-theme",
  schema: {
    root: { kind: "flag" },
    // La red mecánica del hallazgo del eval conducta-theme (2026-07-14):
    // Gemini escribió este marcador sin ningún CSS que reaccionara a .dark —
    // la advertencia en prosa no bastó y el eval era la única red. Acepta CSS
    // crudo (.dark / :root.dark) y variantes dark: de Tailwind — el mismo
    // trío que el assert del eval. Ver requiresCss en types.ts.
    requiresCss: {
      pattern: "\\.dark\\b|:root\\.dark|(?:^|[\\s\"'`])dark:",
      why: "el botón conmuta la clase dark pero ningún CSS de la página la escucha — define el flip :root.dark{…} con valores realmente distintos (como en el ejemplo)",
    },
  },
  js: JS,
  headJs: HEAD_JS,
  budgetBytes: 700,
  docBudgetChars: 1200,
  // control-inert, no content-intact: sin runtime el botón no hace nada —
  // pero es un CONTROL (el toggle de tema), nunca contenido, así que la
  // promesa de este sistema no se rompe. Aceptado por escrito en el spec §13
  // ("theme y countdown degradan a control-inert. Inevitable; aceptado
  // explícitamente").
  degradation: "control-inert",
  a11y: [{ selector: ":root", attr: "aria-label" }],
  doc: {
    label: "tema claro/oscuro",
    when: "Un landing de producto, un portafolio (personal o de developer) o una página de documentación, donde el visitante espera —y valora— poder elegir entre modo claro y oscuro, y quieres que su elección se recuerde entre visitas.",
    // LA GUARDA DE PRODUCTO. Este toggle deroga la regla de la guía de
    // diseño de OpenLen ("una modalidad por página, sin botón de tema") — una
    // derogación que Jesús aprobó explícitamente, PERO con estas guardas. El
    // validador no puede juzgar el rubro de una página (spec §13, limitación
    // conocida #2): la guarda vive enteramente en este texto, que es lo único
    // que lee el modelo antes de decidir dónde poner el marcador.
    //
    // SEGUNDA GUARDA, añadida en el Task 15 (auditoría de los docs que lee la
    // IA): esta receta NO trae `css` (a propósito, igual que sticky) — el
    // toggle solo tiene efecto si la página YA define el flip `:root.dark`
    // con valores REALMENTE distintos a los de `:root`. Ese flip es mandato
    // de la guía de diseño para TODA página ("Declare this canonical
    // vocabulary on :root ... plus a :root.dark flip"), así que en teoría
    // "ya está" — pero el propio producto NO lo asume garantizado: el toggle
    // manual del inspector (properties-panel.tsx, prop `hasDark`) solo se
    // muestra cuando existe un `:root.dark` real y coherente, precisamente
    // porque puede faltar u olvidarse. Sin el recordatorio explícito abajo,
    // esta conducta corre el mismo riesgo que sticky sin CSS: nace muerta.
    whenNot:
      "NUNCA en la página de un negocio local (una taquería, un salón de belleza, un fotógrafo): ningún visitante espera un botón de tema ahí, y romper la modalidad única de la página sin motivo confunde más de lo que ayuda. NUNCA tampoco sobre una temática activa (Temáticas ya fija toda la paleta del kit visual; el toggle se la rompe). Resérvalo para landings de producto, portafolios y páginas de documentación. Y al ponerlo VERIFICA el flip: si la página aún no define `:root.dark{…}` con valores realmente distintos a los de `:root`, escríbelo TÚ en el mismo turno (como en el ejemplo) — sin él este botón conmuta una clase que ningún color escucha.",
    // El <style> del flip va EN el ejemplo a propósito (hallazgo del eval
    // conducta-theme, 2026-07-14: el modelo puso el marcador sin ningún CSS
    // que reaccionara a .dark — la advertencia en prosa no bastó; los modelos
    // copian ejemplos con mucha más fidelidad que prosa). Tokens del contrato
    // de diseño (--bg/--surface/--fg), no inventados.
    example: `<style>:root.dark{--bg:#0f1115;--surface:#171a21;--fg:#e8eaf0}</style>
<button data-ol-theme aria-label="Cambiar entre modo claro y oscuro">Tema</button>`,
  },
  status: "stable",
};
