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
  // Los originales, capturados ANTES de envolver nada: el perseguidor los usa
  // para moverse, o se llamaria a si mismo.
  var origScrollTo = window.scrollTo;
  var origIntoView = Element.prototype.scrollIntoView;
  var irNativo = function (y, suave) {
    try { origScrollTo.call(window, { top: y, behavior: suave ? 'smooth' : 'auto' }); }
    catch (_n) { try { origScrollTo.call(window, 0, y); } catch (_n2) {} }
  };
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

    // 🔴 SE COMPARA EL OBJETIVO, NO DONDE ESTA EL SCROLL AHORA.
    //
    // La primera version miraba |scrollY - y| y re-apuntaba si no habiamos
    // llegado. Eso MATABA LA ANIMACION: las redes de seguridad de mas abajo
    // (load, fonts.ready) disparan a mitad del desplazamiento suave, veian que
    // scrollY todavia estaba a medio camino, y lo corregian de golpe.
    // Reportado por Jesus el 2026-09-01: «sigue sin animacion de
    // desplazamiento».
    //
    // Lo unico que justifica re-apuntar es que el OBJETIVO se haya movido —
    // porque el documento crecio por encima del destino. Si sigue donde
    // estaba, no hay nada que corregir: la animacion en vuelo ya va hacia
    // alli, y dejarla en paz es la respuesta correcta.
    if (intento.ultimoY === y) return;
    var reapuntar = intento.ultimoY !== undefined;
    intento.ultimoY = y;
    // Ya estamos ahi (con 2px de holgura): nada que hacer.
    if (Math.abs(window.scrollY - y) <= 2) return;
    // SUAVE sólo la primera vez, y sólo si el llamador lo quiere. Restaurar
    // una posición tras recargar NO se anima: el usuario no pidió ese viaje y
    // verlo volar es peor que aparecer ya colocado. Un ancla SÍ: ahí el viaje
    // es la respuesta a su clic.
    irNativo(y, !reapuntar && intento.o.suave === true);
  }

  window.__olPerseguir = function (o) {
    if (!o || (!o.el && typeof o.y !== 'number')) return;
    soltar();
    intento = { o: o, hasta: Date.now() + LIMITE, ultimoY: undefined };
    aplicar();
    if (typeof ResizeObserver === 'function') {
      // ⚠️ ResizeObserver ENTREGA UNA OBSERVACION INICIAL nada mas suscribirse,
      // sin que nada haya cambiado. Sin saltarsela, esa llamada llegaba al
      // fotograma siguiente de empezar el desplazamiento suave, veia que
      // scrollY todavia no habia llegado y lo corregia de GOLPE: la animacion
      // se perdia. Reportado por Jesus el 2026-09-01 en cuanto lo probo.
      var primeraObservacion = true;
      // Sobre <html> Y <body>: según cómo esté maquetada la página, el que
      // crece es uno o el otro.
      ro = new ResizeObserver(function () {
        if (primeraObservacion) { primeraObservacion = false; return; }
        aplicar();
      });
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

  // ── LA PRIMITIVA, NO EL EVENTO ──────────────────────────────────────────
  //
  // 🔴 Jesús, 2026-09-01: «que sea un button o un a, todo debe de funcionar».
  // Tiene razón, y la primera versión de esto NO lo cumplía: interceptaba el
  // CLIC de un <a>, así que un <button> cuyo desplazamiento lo hace el
  // JavaScript del modelo seguía roto igual. Arreglar un camino es el parche
  // del que veníamos huyendo.
  //
  // Aquí se envuelve la PRIMITIVA. Cualquiera que pida desplazarse dentro del
  // lienzo —el interceptor de enlaces, el script del modelo, un inyector del
  // editor, código que todavía no existe— recibe la versión que se mantiene,
  // sin saberlo y sin tener que acordarse.
  //
  // SÓLO EN EL LIENZO: estos inyectores llevan data-openlen-inspect y el
  // limpiador los quita, así que la página PUBLICADA conserva el
  // comportamiento nativo del navegador. Lo que se corrige es el entorno de
  // previsualización, que es donde vive el desajuste.
  Element.prototype.scrollIntoView = function (arg) {
    var o = arg && typeof arg === 'object' ? arg : {};
    // SE DELEGA cuando no es un desplazamiento vertical de página: un carrusel
    // horizontal pide inline:'center', y un 'nearest' quiere el mínimo
    // movimiento dentro de su contenedor. Perseguir eso en vertical rompería
    // justo lo que el modelo escribe con Swiper.
    var bloque = o.block === undefined ? 'start' : o.block;
    if (o.inline !== undefined || bloque !== 'start' || !document.contains(this)) {
      return origIntoView.apply(this, arguments);
    }
    window.__olPerseguir({ el: this, suave: true });
  };
})();
`;
