// LOS ENLACES DEL SITIO, DENTRO DEL TALLER.
//
// EL FALLO. El lienzo es un `<iframe srcdoc>`, y un `srcdoc` NO TIENE URL
// PROPIA: un `href="/menu"` no se resuelve contra el sitio del usuario sino
// contra la página que contiene el iframe, que es OpenLen. Pulsabas «menú» en
// tu propia navegación y el lienzo se iba a `localhost:3000/menu` — la app,
// no tu página. Y no había ni un manejador de clics sobre `<a>` en todo el
// taller, así que nada lo impedía.
//
// Resultado: la única forma de comprobar que la navegación de tu sitio funciona
// era PUBLICAR. Para un sitio de tres páginas eso está mal, y desde que
// `/api/generate` crea las subpáginas declaradas le pasa a todo el mundo en su
// primera creación.
//
// Lo que hace este script: se queda con el clic ANTES que nadie (fase de
// captura) y decide por el destino.
//
//   /menu          → no navega: se lo dice al padre, que cambia de página como
//                    lo hace el árbol de la pestaña Site.
//   /              → la Home, igual.
//   #precios       → tampoco navega: se desplaza a mano. El nativo AQUÍ no
//                    funciona — un srcdoc no tiene URL base y el ancla se
//                    resuelve contra el padre.
//   /#artistas     → la portada Y su sección. Es lo que lleva el menú
//                    heredado de una subpágina.
//   https://…      → pestaña nueva. Dejarlo navegar el iframe sacaría al
//                    usuario de su propio taller sin forma de volver.
//   mailto:, tel:, → TAMBIÉN al padre. Decían «se dejan pasar; el navegador
//   whatsapp:        abre el cliente que toque», y el navegador NO PUEDE: con
//                    `sandbox="allow-scripts"` Chromium rechaza toda navegación
//                    a un protocolo externo, y sólo lo dice en la consola de
//                    dentro del lienzo. Era el bug #2 de Jesús — pulsabas el
//                    teléfono de tu página y no pasaba nada. Ver `abrir-fuera.ts`.
//   /lo-que-sea    → tampoco navega, y se dice: esa página no existe. Es el
//                    fallo que hoy es MUDO — una ruta desconocida sirve la
//                    portada con un 200 y el enlace parece funcionar.
//
// SIEMPRE se queda con el clic de un `<a>` interno, mire o edite. Editando, un
// enlace que se lleve el lienzo por delante se lleva también lo que el usuario
// estuviera escribiendo; pero la NAVEGACIÓN sólo se pide cuando NO se está
// editando, porque cambiar de página a media edición es justo lo que
// `switchSitePage` existe para hacer con cuidado.

const SCRIPT = `
(function () {
  if (window.__olPageLinks) return;
  window.__olPageLinks = 1;

  function post(msg) {
    try { window.parent.postMessage(msg, '*'); } catch (_) {}
  }

  // Una ruta interna de UN tramo, que es el modelo de páginas de OpenLen (plano).
  // Se admite la barra final: /contacto y /contacto/ son la misma página.
  function slugDe(href) {
    if (!href) return null;
    if (href === '/' || href === '') return '';
    if (!/^\\/[^/#?\\s]+\\/?$/.test(href)) return null;
    return href.replace(/^\\//, '').replace(/\\/$/, '');
  }

  // EL PADRE PIDE UNA SECCIÓN. Llega tras cambiar de página por un enlace como
  // '/#artistas': el iframe se remonta, así que el desplazamiento no lo puede
  // hacer quien pulsó — lo pide el padre cuando el documento nuevo ya está.
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || d.type !== 'openlen:ir-a-ancla' || typeof d.id !== 'string') return;
    var destino = null;
    try {
      destino = document.getElementById(d.id) || document.querySelector('[name="' + d.id + '"]');
    } catch (_) {}
    if (destino && destino.scrollIntoView) {
      destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      post({ type: 'openlen:ancla-perdida', id: d.id });
    }
  });

  document.addEventListener(
    'click',
    function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      // El propio taller cuelga anclas dentro de sus overlays; las suyas no son
      // enlaces de la página del usuario.
      if (a.closest('[data-openlen-inspect],[data-openlen-edit-overlay],[data-openlen-section-insert]')) return;

      var href = a.getAttribute('href');
      if (!href) return;

      // ANCLAS DE ESTA MISMA PÁGINA — y NO, el navegador no hace lo correcto.
      //
      // Misma causa que todo lo demás: un srcdoc no tiene URL base, así que
      // '#precios' se resuelve contra la URL del PADRE y el iframe navega a
      // openlen.com/...#precios — fuera del documento, lienzo en blanco.
      //
      // MEDIDO el 2026-08-27 con Chromium: la primera versión de este script
      // dejaba pasar las anclas «porque el navegador ya hace lo correcto», y el
      // frame acabó en http://127.0.0.1:PUERTO/#precios. Y las anclas son la
      // navegación de CASI TODAS las páginas generadas —el corpus del repo no
      // tiene una sola ruta, todo son #seccion—, así que el menú de cualquier
      // página estaba muerto en el taller desde siempre.
      //
      // Se desplaza a mano, que es lo que el usuario esperaba.
      if (href.charAt(0) === '#') {
        e.preventDefault();
        e.stopPropagation();
        var id = href.slice(1);
        if (!id) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        var destino = null;
        try {
          destino = document.getElementById(id) || document.querySelector('[name="' + id + '"]');
        } catch (_) {}
        if (destino && destino.scrollIntoView) {
          destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          // El ancla no existe. Publicada no haría nada tampoco, pero ahí el
          // silencio es del navegador; aquí se puede decir.
          post({ type: 'openlen:ancla-perdida', id: id });
        }
        return;
      }

      var esHttp = /^https?:/i.test(href);

      // ESQUEMAS QUE ABREN OTRA COSA (correo, teléfono, WhatsApp): TAMBIÉN AL
      // PADRE. Aquí ponía «que el navegador mande» — y el navegador no manda:
      // con sandbox="allow-scripts" (sin allow-popups y sin allow-top-navigation)
      // Chromium RECHAZA la navegación a cualquier protocolo externo y sólo lo
      // escribe en la consola de DENTRO, que ni el usuario ve ni el padre puede
      // leer. Pulsabas el teléfono de tu propia página y no pasaba nada.
      //
      // El href ya es absoluto —lleva esquema—, así que se manda TAL CUAL y no
      // a.href: en un ancla de SVG eso no es una cadena, y viajaría vacío.
      if (!esHttp && /^[a-z][a-z0-9+.-]*:/i.test(href)) {
        e.preventDefault();
        e.stopPropagation();
        post({ type: 'openlen:abrir-fuera', url: href });
        return;
      }

      // Un destino de fuera. NUNCA en este iframe: sacaría al usuario de su
      // taller y no hay botón de volver dentro del lienzo.
      //
      // LO ABRE EL PADRE, no nosotros. El lienzo corre con sandbox="allow-scripts"
      // y SIN allow-popups, así que un window.open desde aquí lo bloquea el
      // navegador — el enlace no haría nada y no habría ni un error. Se manda
      // arriba, que no está en caja.
      if (esHttp || a.target === '_blank') {
        e.preventDefault();
        e.stopPropagation();
        post({ type: 'openlen:abrir-fuera', url: a.href });
        return;
      }

      // A partir de aquí es una ruta del propio sitio. El iframe NO navega
      // pase lo que pase: es lo que rompía el lienzo.
      e.preventDefault();
      e.stopPropagation();
      // Editando no se cambia de página por un clic: el usuario está
      // trabajando, y el clic pudo ser para editar el texto del enlace.
      if (document.body && document.body.hasAttribute('data-openlen-edit-mode')) return;

      // OTRA PÁGINA Y ADEMÁS UNA SECCIÓN: '/#artistas', '/menu#precios'. Es lo
      // que lleva el menú heredado de una subpágina — sus anclas apuntan a las
      // secciones de la PORTADA, que aquí no existen, así que se reescriben a
      // '/#seccion' al construir el armazón (buildPageShell). Viajan la ruta y
      // el ancla juntas: el padre cambia de página y le pide a la nueva que
      // baje hasta ahí.
      var corte = href.indexOf('#');
      var ancla = corte === -1 ? '' : href.slice(corte + 1);
      var ruta = corte === -1 ? href : (href.slice(0, corte) || '/');

      post({
        type: 'openlen:ir-a-pagina',
        slug: slugDe(ruta),
        ancla: ancla,
        href: href,
        texto: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60)
      });
    },
    true,
  );
})();
`;

/** Devuelve el HTML con el manejador de enlaces inyectado antes de `</body>`.
 *  Lleva `data-openlen-inspect` para que el limpiador de instrumentación lo
 *  quite: nunca llega al documento guardado ni al publicado. */
export function injectPageLinks(html: string): string {
  if (!html) return html;
  const idx = html.lastIndexOf("</body>");
  const tag = `<script data-openlen-inspect>${SCRIPT}</script>`;
  return idx === -1 ? html + tag : html.slice(0, idx) + tag + html.slice(idx);
}
