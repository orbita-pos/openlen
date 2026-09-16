import { RUTAS_SOLO_PUBLICADA } from "@/lib/lienzo/rutas-solo-publicada";

// LO QUE SÓLO FUNCIONA PUBLICADO, DICHO EN EL LIENZO.
//
// Es la mitad «decir» de la acción `preview` de Claude Code: lo que su vista
// previa no puede replicar lo devuelve como hallazgo con lo que hará la
// publicada. Aquí se lo dice al usuario, que es quien pulsa. Spec 2026-09-15,
// tabla B.
//
// Va el PRIMERO del <head>: tiene que envolver fetch y XHR antes de que el
// script de la página los guarde en una variable.
//
//   · fetch/XHR a una ruta de RUTAS_SOLO_PUBLICADA → aviso `llamada`. La
//     llamada SIGUE: la página ve la respuesta real (403/404) y hace lo suyo.
//   · un envío nativo que nadie paró → se para y aviso `formulario`. Publicada
//     iría a /api/f y llegaría a la bandeja del dueño.
//   · navegar por script (Navigation API) → una ruta de un tramo pide el cambio
//     de página al padre (`openlen:ir-a-pagina`, el mismo mensaje que un clic
//     en use-page-links.ts); otra cosa se para y aviso `navegacion`.
//
// ⚠️ LÍMITE CONOCIDO: un manejador de `submit` que la página registra en
// `window` DESPUÉS que éste, y que cancela, llega tarde: este ya paró el envío
// y avisó. Uno sobre el <form> o el document (lo normal) sí se respeta.

const SCRIPT = `(function () {
  if (window.__olSoloPublicada) return;
  window.__olSoloPublicada = 1;
  var RUTAS = ${JSON.stringify(RUTAS_SOLO_PUBLICADA)};
  function avisar(m) { try { window.parent.postMessage(m, '*'); } catch (_) {} }
  function rutaDe(u) { try { return new URL(String(u), document.baseURI).pathname; } catch (_) { return ''; } }
  function soloPublicada(u) {
    var p = rutaDe(u);
    for (var i = 0; i < RUTAS.length; i++) if (p.indexOf(RUTAS[i]) === 0) return p;
    return null;
  }
  var f = window.fetch;
  if (f) {
    window.fetch = function (input) {
      var u = input && typeof input === 'object' && 'url' in input ? input.url : input;
      var r = soloPublicada(u);
      if (r) avisar({ type: 'openlen:solo-publicada', tipo: 'llamada', ruta: r });
      return f.apply(this, arguments);
    };
  }
  var abrir = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (_m, u) {
    var r = soloPublicada(u);
    if (r) avisar({ type: 'openlen:solo-publicada', tipo: 'llamada', ruta: r });
    return abrir.apply(this, arguments);
  };
  window.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    avisar({ type: 'openlen:solo-publicada', tipo: 'formulario' });
  });
  var nav = window.navigation;
  if (nav && nav.addEventListener) {
    nav.addEventListener('navigate', function (e) {
      if (!e.cancelable || e.hashChange || e.downloadRequest) return;
      var destino = e.destination && e.destination.url ? String(e.destination.url) : '';
      var d;
      try { d = new URL(destino); } catch (_) { return; }
      if (d.origin === location.origin && d.pathname === location.pathname) return;
      e.preventDefault();
      if (document.body && document.body.hasAttribute('data-openlen-edit-mode')) return;
      var tramo = d.origin === location.origin ? /^\\/([a-z0-9-]*)\\/?$/.exec(d.pathname) : null;
      if (tramo) {
        avisar({ type: 'openlen:ir-a-pagina', slug: tramo[1], ancla: '', href: d.pathname, texto: '' });
        return;
      }
      avisar({ type: 'openlen:solo-publicada', tipo: 'navegacion', destino: destino.slice(0, 200) });
    });
  }
})();`;

/** El HTML con el aviso inyectado el PRIMERO del <head>. */
export function injectSoloPublicada(html: string): string {
  if (!html) return html;
  const tag = `<script data-openlen-solo-publicada>${SCRIPT}</script>`;
  const cabeza = /<head\b[^>]*>/i.exec(html);
  if (cabeza) return html.slice(0, cabeza.index + cabeza[0].length) + tag + html.slice(cabeza.index + cabeza[0].length);
  const html_ = /<html\b[^>]*>/i.exec(html);
  if (html_) return html.slice(0, html_.index + html_[0].length) + `<head>${tag}</head>` + html.slice(html_.index + html_[0].length);
  return tag + html;
}
