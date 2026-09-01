// UNA POSICIÓN QUE SE MANTIENE, NO UNA ORDEN QUE SE DISPARA.
//
// 🔴 EL FALLO QUE ESTO CIERRA, y por qué llevaba tres parches sin cerrarse.
//
// `scrollTo` y `scrollIntoView` son órdenes de UN SOLO DISPARO contra la
// maqueta del instante en que se llaman. Si el documento todavía está
// creciendo, la orden no se aplica mal: SE PIERDE ENTERA, en silencio, porque
// el navegador la recorta contra una altura que aún no es la definitiva.
//
// Medido con Chromium el 2026-09-01, pulsando «Ver trabajos» (`#trabajos`)
// sobre una página con una imagen que llega tarde:
//
//   1. load, imagen en el aire     altoDoc= 800  maxScroll=   0  top#trabajos= 445
//   2. tras pulsar el enlace       altoDoc= 800  maxScroll=   0  top#trabajos= 445
//   3. la imagen crece el documento altoDoc=1925 maxScroll=1125  top#trabajos=1725
//
// En el paso 2 `maxScroll` es CERO. No hay a dónde ir, así que no va.
//
// LOS PARCHES ANTERIORES MOVÍAN EL INSTANTE — `DOMContentLoaded` → `load`
// (`fb659450`)— buscando «cuándo ha terminado de medir». Ese instante NO
// EXISTE: después de `load` el documento sigue creciendo por cuatro relojes
// distintos, y ninguno es el último.
//
//   · las imágenes perezosas de debajo del pliegue no bloquean `load`
//   · las fuentes web se intercambian después y reflotan el texto
//   · Tailwind por CDN es un compilador EN RUNTIME: genera CSS tras parsear
//   · y el JavaScript del modelo corre y puede añadir contenido
//
// LA FORMA CORRECTA es dejar de perseguir un instante y perseguir una
// CONDICIÓN: se registra la intención («el usuario quiere este elemento
// arriba») y se vuelve a satisfacer cada vez que el documento CAMBIA, hasta que
// el usuario tome el control o se agote el plazo. Un `ResizeObserver` sólo
// dispara cuando algo se movió, así que en una página quieta esto no hace
// absolutamente nada.
//
// EL USUARIO MANDA: al primer gesto de scroll suyo —rueda, dedo, tecla— la
// intención se suelta. Que el lienzo te devuelva a un sitio del que acabas de
// salir sería peor que el fallo original.
//
// SIRVE PARA LOS DOS CAMINOS, que eran el mismo fallo con dos ropas: el ancla
// de `use-page-links.ts` y el `openlen:restore-scroll` de `use-inline-edit.ts`.

/** El plazo máximo que se persigue una posición. Generoso para una galería con
 *  fotos pesadas, y corto para que nunca pelee con un usuario que se fue a
 *  hacer otra cosa. */
export const PERSEGUIR_LIMITE_MS = 5000;

/**
 * El instalador, como TEXTO: los dos llamadores son scripts inyectados en el
 * iframe (origen opaco), así que esto no puede ser un import — tiene que
 * viajar dentro del `<script>`.
 *
 * Idempotente: los dos inyectores lo incluyen y sólo el primero lo instala.
 * Deja `window.__olPerseguir(objetivo)`, donde objetivo es `{el}` o `{y}`.
 */
export const PERSEGUIR_SCROLL_JS = `
(function () {
  if (window.__olPerseguir) return;
  var LIMITE = ${PERSEGUIR_LIMITE_MS};
  var intento = null;
  var ro = null;

  function quiereY(o) {
    if (o.el) {
      // Recalculado CADA vez: si algo crece por encima del destino, su
      // posición absoluta cambia — y ése es justo el caso que rompía.
      var r = o.el.getBoundingClientRect();
      return Math.max(0, Math.round(window.scrollY + r.top));
    }
    return Math.max(0, o.y || 0);
  }

  function soltar() {
    intento = null;
    if (ro) { try { ro.disconnect(); } catch (_d) {} ro = null; }
  }

  function aplicar() {
    if (!intento) return;
    if (Date.now() > intento.hasta) return soltar();
    var quiero = quiereY(intento.o);
    var max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    var y = Math.min(quiero, max);
    // Un umbral de 2px: por debajo de eso no hay nada que corregir y evita
    // pelearse con la cola de un desplazamiento suave.
    if (Math.abs(window.scrollY - y) <= 2) return;
    try {
      window.scrollTo({ top: y, behavior: intento.primera ? 'smooth' : 'auto' });
    } catch (_e) {
      try { window.scrollTo(0, y); } catch (_e2) {}
    }
    intento.primera = false;
  }

  window.__olPerseguir = function (o) {
    if (!o || (!o.el && typeof o.y !== 'number')) return;
    soltar();
    intento = { o: o, hasta: Date.now() + LIMITE, primera: true };
    aplicar();
    if (typeof ResizeObserver === 'function') {
      // Sobre <html> Y <body>: según cómo esté maquetada la página, el que
      // crece es uno o el otro.
      ro = new ResizeObserver(aplicar);
      try { ro.observe(document.documentElement); } catch (_o1) {}
      try { if (document.body) ro.observe(document.body); } catch (_o2) {}
    }
    // Red por si el documento crece sin que el observador lo note (una fuente
    // que se intercambia no siempre cambia la altura del elemento observado).
    window.addEventListener('load', aplicar);
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(aplicar).catch(function () {});
    }
  };

  // EL USUARIO MANDA. En cuanto toca el scroll, la intención se suelta.
  ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function (ev) {
    window.addEventListener(ev, soltar, { passive: true, capture: true });
  });
})();
`;
