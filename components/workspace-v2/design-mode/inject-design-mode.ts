// EL MODO DISEÑO EN EL LIENZO DE UNA APP (spec 2026-10-11-modo-diseno-de-apps).
//
// Siempre inyectado y dormido, como los otros scripts del editor
// (`preview-area.tsx`, derive): se despierta con `openlen:set-mode` y
// `designMode: true`. Elegir no toca la app: el clic se para en `window`, en
// captura, antes de que llegue a React. La vista previa es estilo en línea
// (con `!important`) y texto o `src`; un MutationObserver la vuelve a poner si
// React repinta o monta un nodo nuevo. Restaurar quita exactamente lo puesto.
// Nada de esto se guarda: en una app el lienzo no se serializa nunca.
import { DESIGN_LIMITS, DESIGN_PROPERTIES } from "@/lib/apps/design/types";
import { ownTextOf, primaryOf, readStylesOf, sourceChainOf, targetsOf } from "@/lib/apps/design/canvas-functions";
import { decl } from "../serializar-al-iframe";

const STYLE = `
body[data-openlen-design-mode] [data-openlen-design-hover] { outline: 2px solid rgba(255,90,54,0.4) !important; outline-offset: -2px !important; cursor: pointer !important; }
body[data-openlen-design-mode] [data-openlen-design-selected] { outline: 2px solid rgba(255,90,54,0.95) !important; outline-offset: -2px !important; }
`;

const SCRIPT = `(function () {
  if (window.__openlenDesignMode) return;
  window.__openlenDesignMode = true;
  ${decl("sourceChainOf", sourceChainOf)}
  ${decl("primaryOf", primaryOf)}
  ${decl("ownTextOf", ownTextOf)}
  ${decl("readStylesOf", readStylesOf)}
  ${decl("targetsOf", targetsOf)}
  var PROPS = ${JSON.stringify(DESIGN_PROPERTIES)};
  var MAX_CHAIN = ${DESIGN_LIMITS.chain};
  var MAX_TEXT = ${DESIGN_LIMITS.text};
  var on = false, hovered = null, selected = null, nextId = 1;
  var previews = {};          // key → mensaje de vista previa
  var touched = {};           // key → [elementos tocados]
  var originals = new WeakMap();
  var observer = null, frame = 0;

  function post(msg) { try { window.parent.postMessage(msg, '*'); } catch (_) {} }
  function screen() { return location.hash || '#/'; }

  function describe(el) {
    var chain = sourceChainOf(el, MAX_CHAIN);
    var p = primaryOf(chain);
    var tag = el.tagName.toLowerCase();
    var link = p >= 0 ? chain[p] : null;
    var designId = null;
    if (!link) {
      designId = el.getAttribute('data-openlen-design-id');
      if (!designId) { designId = String(nextId++); el.setAttribute('data-openlen-design-id', designId); }
    }
    var full = ownTextOf(el, 100000);
    return {
      key: link ? screen() + '|' + link.path + ':' + link.line + '|' + tag + (link.site ? '|' + link.site : '') : 'id:' + designId,
      chain: chain, primary: p, tag: tag,
      text: ownTextOf(el, MAX_TEXT),
      textEditable: el.children.length === 0 && full.length > 0,
      copies: link ? Math.max(1, targetsOf(link.path, link.line, tag, MAX_CHAIN, link.site).length) : 1,
      screen: screen(),
      styles: readStylesOf(el, PROPS),
      image: tag === 'img' ? { src: el.getAttribute('src') || '', alt: el.getAttribute('alt') || '' } : null,
      designId: designId,
      fonts: fontsLoaded()
    };
  }
  function fontsLoaded() {
    var out = [];
    try { document.fonts.forEach(function (f) { var n = String(f.family).replace(/^["']|["']$/g, ''); if (out.indexOf(n) === -1) out.push(n); }); } catch (_) {}
    return out.slice(0, 40);
  }
  // LA APP NO CORRE (no compila, o el empaquetador no contestó): el lienzo
  // enseña la capa de error de Vite y no hay nada que elegir. El modo se apaga.
  function appBroken() { return !!document.querySelector('openlen-error-overlay'); }

  function setHover(el) {
    if (hovered && hovered !== el) hovered.removeAttribute('data-openlen-design-hover');
    hovered = el;
    if (el) el.setAttribute('data-openlen-design-hover', '');
  }
  function select(el) {
    if (selected) selected.removeAttribute('data-openlen-design-selected');
    selected = el;
    if (!el) return;
    el.setAttribute('data-openlen-design-selected', '');
    post({ type: 'openlen:design-selected', selection: describe(el) });
  }

  function targetsFor(p) {
    if (p.screen !== screen()) return [];
    if (p.target && p.target.designId) {
      var e = document.querySelector('[data-openlen-design-id="' + p.target.designId + '"]');
      return e ? [e] : [];
    }
    // Con el sitio, sólo esa etiqueta del código; si el paquete cambió (otro
    // documento) y ya no hay ninguna con ese sitio, por fichero y línea.
    var t = targetsOf(p.target.path, p.target.line, p.target.tag, MAX_CHAIN, p.target.site);
    if (t.length === 0 && p.target.site) t = targetsOf(p.target.path, p.target.line, p.target.tag, MAX_CHAIN);
    return t;
  }
  function textNodesOf(el) {
    var out = [];
    for (var i = 0; i < el.childNodes.length; i++) if (el.childNodes[i].nodeType === 3) out.push(el.childNodes[i]);
    return out;
  }
  function remember(el) {
    if (!originals.has(el)) originals.set(el, { style: {}, text: null, wrote: null, src: null, alt: null });
    return originals.get(el);
  }
  function restoreEl(el) {
    var o = originals.get(el);
    if (!o) return;
    for (var k in o.style) { if (o.style[k].v) el.style.setProperty(k, o.style[k].v, o.style[k].p); else el.style.removeProperty(k); }
    if (o.text !== null) {
      var tn = textNodesOf(el);
      for (var r = 0; r < tn.length && r < o.text.length; r++) if (o.text[r] !== undefined) tn[r].nodeValue = o.text[r];
    }
    if (o.src !== null) el.setAttribute('src', o.src);
    if (o.alt !== null) el.setAttribute('alt', o.alt);
    originals.delete(el);
  }
  function apply(p) {
    var ts = targetsFor(p);
    var list = touched[p.key] || (touched[p.key] = []);
    for (var i = 0; i < ts.length; i++) {
      var el = ts[i], o = remember(el);
      if (list.indexOf(el) === -1) list.push(el);
      for (var k in p.styles) {
        if (!(k in o.style)) o.style[k] = { v: el.style.getPropertyValue(k), p: el.style.getPropertyPriority(k) };
        if (el.style.getPropertyValue(k) !== p.styles[k] || el.style.getPropertyPriority(k) !== 'important') el.style.setProperty(k, p.styles[k], 'important');
      }
      // EL TEXTO, en los nodos de React y sin cambiarlos por otros: si se
      // reemplazan, React escribe sus cambios en nodos que ya no están y el
      // texto deja de actualizarse. Lo que React escribió desde la última vez
      // es el valor de verdad para restaurar.
      if (typeof p.text === 'string') {
        var tns = textNodesOf(el);
        if (o.text === null) { o.text = []; o.wrote = []; }
        for (var t = 0; t < tns.length; t++) {
          if (o.wrote[t] === undefined || tns[t].nodeValue !== o.wrote[t]) o.text[t] = tns[t].nodeValue;
          var nuevo = t === 0 ? p.text : '';
          if (tns[t].nodeValue !== nuevo) tns[t].nodeValue = nuevo;
          o.wrote[t] = nuevo;
        }
      }
      if (typeof p.src === 'string') { if (o.src === null) o.src = el.getAttribute('src') || ''; if (el.getAttribute('src') !== p.src) el.setAttribute('src', p.src); }
      if (typeof p.alt === 'string') { if (o.alt === null) o.alt = el.getAttribute('alt') || ''; if (el.getAttribute('alt') !== p.alt) el.setAttribute('alt', p.alt); }
    }
  }
  function clear(key) {
    var keys = key ? [key] : Object.keys(previews);
    for (var i = 0; i < keys.length; i++) {
      var list = touched[keys[i]] || [];
      for (var j = 0; j < list.length; j++) restoreEl(list[j]);
      delete touched[keys[i]];
      delete previews[keys[i]];
    }
  }
  function reapplyAll() {
    if (observer) observer.disconnect();
    for (var k in previews) apply(previews[k]);
    watch();
  }
  function watch() {
    if (!observer) observer = new MutationObserver(function () {
      if (frame) return;
      frame = requestAnimationFrame(function () { frame = 0; reapplyAll(); });
    });
    if (document.body) observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  function isOurs(el) {
    return !el || el === document.body || el === document.documentElement || !!(el.closest && el.closest('openlen-error-overlay'));
  }
  window.addEventListener('mousemove', function (e) {
    if (!on) return;
    var el = e.target && e.target.nodeType === 1 ? e.target : null;
    setHover(isOurs(el) ? null : el);
  }, true);
  // SE ELIGE EN pointerdown, no en click: Chromium no entrega el clic a un
  // control deshabilitado (el botón «Añadir» con el campo vacío), y el
  // pointerdown sí. El clic se traga igual, para que no llegue a la app.
  window.addEventListener('pointerdown', function (e) {
    if (!on) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    var el = e.target && e.target.nodeType === 1 ? e.target : null;
    if (!isOurs(el)) select(el);
  }, true);
  ['click', 'mousedown', 'mouseup', 'pointerup', 'submit'].forEach(function (t) {
    window.addEventListener(t, function (e) { if (on) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); } }, true);
  });
  window.addEventListener('keydown', function (e) {
    if (on && e.key === 'Escape') { e.preventDefault(); post({ type: 'openlen:design-exit' }); }
  }, true);
  window.addEventListener('hashchange', function () { select(null); reapplyAll(); });

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'openlen:set-mode' && 'designMode' in d) {
      on = !!d.designMode && !appBroken();
      if (d.designMode && !on) post({ type: 'openlen:design-exit', reason: 'broken' });
      if (document.body) { if (on) document.body.setAttribute('data-openlen-design-mode', ''); else document.body.removeAttribute('data-openlen-design-mode'); }
      if (!on) { setHover(null); select(null); }
    } else if (d.type === 'openlen:design-preview' && typeof d.key === 'string' && d.target) {
      var list = touched[d.key] || [];
      for (var i = 0; i < list.length; i++) restoreEl(list[i]);
      touched[d.key] = [];
      previews[d.key] = d;
      if (observer) observer.disconnect();
      apply(d);
      watch();
    } else if (d.type === 'openlen:design-clear') {
      if (observer) observer.disconnect();
      clear(typeof d.key === 'string' ? d.key : null);
      watch();
    } else if (d.type === 'openlen:design-select-parent') {
      if (selected && selected.parentElement && !isOurs(selected.parentElement)) select(selected.parentElement);
    }
  });
  watch();
})();`;

const INJECTION = `<style data-openlen-design>${STYLE}</style><script data-openlen-design>${SCRIPT}</script>`;

/** Lo mete antes de `</body>` (o al final, si no hay). Idempotente. */
export function injectDesignMode(html: string): string {
  if (html.includes("data-openlen-design>")) return html;
  const i = html.lastIndexOf("</body>");
  return i === -1 ? html + INJECTION : html.slice(0, i) + INJECTION + html.slice(i);
}
