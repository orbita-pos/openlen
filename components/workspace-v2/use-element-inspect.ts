import {
  buildEditPath,
  editChildTags,
  isEditorNode,
  EDITOR_NODE_ATTRS,
} from "./edit-path";

// Element-inspect injection for the iframe — powers the right-side
// Properties panel (Phase 1). Forked from use-section-select.ts (the
// hover+click picker) and use-image-replace.ts (the parent-driven mutate
// + postClean pattern). Unlike section-select, selection is PERSISTENT:
// the clicked element keeps an outline so the panel and the page stay
// visually linked while the user edits.
//
// Parent contract (postMessage):
//   OUT { type: "openlen:page-meta", meta }                       // on init + after a page edit
//   OUT { type: "openlen:element-selected", path, tag, hint, props }
//   OUT { type: "openlen:element-deselected" }                    // ESC
//   OUT { type: "openlen:html-changed", outerHtml, source: "props" }
//   IN  { type: "openlen:apply-prop", scope: "element", path, name, value }
//   IN  { type: "openlen:apply-prop", scope: "page", field, value }
//
// `props` carries only what Phase 1 edits: href/target/rel for links,
// alt/src for images. `value: null` removes the attribute. Body edits and
// <head> edits both funnel through postClean, so persistence reuses the
// existing openlen:html-changed → PATCH /html path (spike-verified byte-safe).

import { splitContainer } from "./drop-place-core";
import { DESIGN_STASH_ATTR, parseStash, serializeStash } from "./design-stash";

const INSPECT_STYLE = `
[data-openlen-inspect-hover] {
  outline: 2px solid rgba(255,90,54,0.4) !important;
  outline-offset: -2px !important;
}
[data-openlen-inspect-selected] {
  outline: 2px solid rgba(255,90,54,0.95) !important;
  outline-offset: -2px !important;
}
body[data-openlen-edit-mode] [data-openlen-inspect-hover] {
  cursor: pointer !important;
}
/* Editor V3 gate — outlines only render when edit mode is on. The script
   is persistent in the iframe and only updates hover/selected attrs while
   in edit mode (handler-level gate), but the gate here also masks any
   leftover attrs from a stale mid-toggle state. */
body:not([data-openlen-edit-mode]) [data-openlen-inspect-hover],
body:not([data-openlen-edit-mode]) [data-openlen-inspect-selected] {
  outline: none !important;
}
/* "Hide element" — in EDIT mode a hidden element stays visible (dimmed +
   dashed) so it's still selectable / un-hideable; the persistent rule injected
   by ensureHiddenStyle() actually hides it everywhere else (preview + publish). */
body[data-openlen-edit-mode] [data-ol-hidden] {
  opacity: 0.4 !important;
  outline: 1px dashed rgba(255,90,54,0.7) !important;
  outline-offset: -1px !important;
}
`;

const INSPECT_SCRIPT = `
(function () {
  // Shared with the drop engine (drop-place-core.ts) — the SAME tested
  // function decides splittability there and picks the transform target here.
  var splitContainer = ${splitContainer.toString()};
  var STASH_ATTR = ${JSON.stringify(DESIGN_STASH_ATTR)};
  var parseStash = ${parseStash.toString()};
  var serializeStash = ${serializeStash.toString()};

  // Primer toque gana: guarda el valor inline PREVIO antes de que un control
  // escriba — el stash siempre contiene el valor de diseño, nunca uno
  // intermedio del usuario.
  function stashProp(el, prop) {
    var map = parseStash(el.getAttribute(STASH_ATTR));
    if (Object.prototype.hasOwnProperty.call(map, prop)) return;
    map[prop] = el.style.getPropertyValue(prop);
    var s = serializeStash(map);
    if (s !== null) el.setAttribute(STASH_ATTR, s);
  }

  function restoreProps(el, props) {
    var map = parseStash(el.getAttribute(STASH_ATTR));
    for (var i = 0; i < props.length; i++) {
      var prop = props[i];
      if (!Object.prototype.hasOwnProperty.call(map, prop)) continue;
      if (map[prop]) el.style.setProperty(prop, map[prop]);
      else el.style.removeProperty(prop);
      delete map[prop];
    }
    var s = serializeStash(map);
    if (s === null) el.removeAttribute(STASH_ATTR);
    else el.setAttribute(STASH_ATTR, s);
  }

  function applyReset(path, props) {
    var el = resolvePath(path);
    if (!el || !props.length) return;
    restoreProps(el, props);
    // The reset may drop a bg the re-ink pass compensated for — put the
    // original colors back or light text strands on a restored light bg.
    for (var ri = 0; ri < props.length; ri++) {
      if (props[ri].indexOf('background') === 0) { olRestoreReinkIn(el); break; }
    }
    postEdicion(el);
    if (selected === el) postSelected(el);
  }

  var SKIP = {HTML:1,HEAD:1,BODY:1,SCRIPT:1,STYLE:1,LINK:1,META:1,TITLE:1,NOSCRIPT:1,TEMPLATE:1};
  var hovered = null;
  var selected = null;

  function selectable(el) {
    if (!el || !el.tagName) return false;
    if (SKIP[el.tagName]) return false;
    if (el.closest && el.closest('script, style, noscript, template')) return false;
    return true;
  }

  // A click usually lands on an inline span inside the link/image — the
  // user means the link or the image, so climb to it when there is one.
  function resolveTarget(el) {
    if (!el) return null;
    var pick = el.closest ? el.closest('a, img') : null;
    return pick || el;
  }

  // CSS :nth-of-type breadcrumb from the element up to <body> (exclusive).
  // Per-tag, so our own injected <style>/<script> don't shift the counts.
  function buildPath(el) {
    var segs = [];
    var cur = el;
    while (cur && cur.tagName !== 'BODY' && cur.tagName !== 'HTML' && cur.parentElement) {
      var tag = cur.tagName.toLowerCase();
      var nth = 1;
      var sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) nth += 1;
        sib = sib.previousElementSibling;
      }
      segs.unshift(tag + ':nth-of-type(' + nth + ')');
      cur = cur.parentElement;
    }
    return segs.join(' > ');
  }

  function buildHint(el) {
    var text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text.length > 54) text = text.slice(0, 54) + '…';
    if (text) return text;
    var alt = el.getAttribute && el.getAttribute('alt');
    if (alt) return alt;
    if (el.id) return '#' + el.id;
    return el.tagName.toLowerCase();
  }

  // Breadcrumb up the DOM from the selected element's parent — closest first,
  // capped at 4, stopping at BODY/HTML. Only selectable ancestors are
  // included (mirrors the click picker's own filter), so the trail never
  // offers a hop to <script>/<style>/etc.
  function buildAncestors(el) {
    var out = [];
    var cur = el.parentElement;
    while (cur && cur.tagName !== 'BODY' && cur.tagName !== 'HTML' && out.length < 4) {
      if (selectable(cur)) {
        out.push({ path: buildPath(cur), tag: cur.tagName.toLowerCase(), hint: buildHint(cur) });
      }
      cur = cur.parentElement;
    }
    return out;
  }

  function readProps(el) {
    var tag = el.tagName.toLowerCase();
    var props = {};
    if (tag === 'a') {
      props.href = el.getAttribute('href') || '';
      props.target = el.getAttribute('target') || '';
      props.rel = el.getAttribute('rel') || '';
    } else if (tag === 'img') {
      props.alt = el.getAttribute('alt') || '';
      props.src = el.getAttribute('src') || '';
    }
    return props;
  }

  // Index of the <form> enclosing el among all forms in document order —
  // the key the inspector and publish-time wiring share. null when el is
  // not inside a form.
  function formIndexOf(el) {
    var form = el.closest ? el.closest('form') : null;
    if (!form) return null;
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      if (forms[i] === form) return i;
    }
    return null;
  }

  // Identidad estable del <form> que envuelve a el, si la tiene. Es lo que
  // ata la configuracion (correo de aviso, mensaje de exito) a ESTE formulario
  // y no a su posicion en el documento: mover el formulario ya no manda los
  // leads al correo de otro. Vacia en paginas anteriores al estampado, donde
  // el servidor cae a formIndex.
  function formIdOf(el) {
    var form = el.closest ? el.closest('form') : null;
    if (!form) return null;
    var id = form.getAttribute('data-ol-form-id');
    return id && id.trim() ? id.trim() : null;
  }

  // Convert a computed rgb()/rgba() string to #rrggbb. Returns '' for a
  // fully-transparent color (a color <input> can't represent it).
  function rgbToHex(c) {
    var m = (c || '').match(/[\\d.]+/g);
    if (!m || m.length < 3) return '';
    if (m.length >= 4 && parseFloat(m[3]) === 0) return '';
    function h(n) {
      var s = Math.round(parseFloat(n)).toString(16);
      return s.length < 2 ? '0' + s : s;
    }
    return '#' + h(m[0]) + h(m[1]) + h(m[2]);
  }

  // The selected element's own cascade-safe style — what the inspector's
  // Style section reads. Colors as #rrggbb, borderRadius as an integer px.
  function readStyle(el) {
    var cs;
    try { cs = getComputedStyle(el); } catch (_) { return {}; }
    var br = parseInt(cs.borderRadius, 10);
    // Background paint: an element can be filled by a gradient or an image
    // (background-image), which sits ON TOP of background-color — so editing
    // the color alone would be invisible. Report the fill state so the panel
    // can offer the right control (solid color that replaces the fill, or a
    // "fill with image"). bgImageUrl is the url() if the fill is a picture.
    var bgImg = cs.backgroundImage || 'none';
    var urlMatch = bgImg.match(/url\\(["']?(.*?)["']?\\)/i);
    var bw = parseInt(cs.borderTopWidth, 10);
    return {
      color: rgbToHex(cs.color),
      backgroundColor: rgbToHex(cs.backgroundColor),
      borderRadius: isNaN(br) ? '' : String(br),
      hasBgImage: bgImg !== 'none' && bgImg !== '',
      hasGradient: /gradient/i.test(bgImg),
      // Raw gradient string for the panel's round-trip editor — pure
      // gradients only (a scrim+photo layer list must never prefill it).
      bgGradient: (/gradient/i.test(bgImg) && bgImg.indexOf('url(') === -1) ? bgImg : '',
      bgImageUrl: urlMatch ? urlMatch[1] : '',
      borderWidth: isNaN(bw) ? '' : String(bw),
      borderColor: rgbToHex(cs.borderTopColor),
      fontWeight: (cs.fontWeight || '').toString(),
      fontStyle: cs.fontStyle || '',
      textAlign: cs.textAlign || '',
      hidden: !!(el.hasAttribute && el.hasAttribute('data-ol-hidden')),
      fontSizePx: (function () { var n = parseFloat(cs.fontSize); return isNaN(n) ? 0 : Math.round(n); })(),
      hasText: (function () {
        // Texto DIRECTO — el caso normal (<h1>Hola</h1>).
        for (var n = el.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 3 && /\\S/.test(n.nodeValue)) return true;
        }
        // Texto envuelto en inline (<h1><span>Hola</span></h1>): antes el grupo
        // Texto DESAPARECÍA al seleccionar el heading — el usuario tenía que
        // cazar el span, e inconsistente además, porque clickear sobre la letra
        // sí lo mostraba (selecciona el span). Cualquier hijo de BLOQUE lo
        // descarta, para que secciones y tarjetas (que contienen headings y
        // párrafos) sigan sin ofrecer controles de texto.
        if (!/\\S/.test(el.textContent || '')) return false;
        var kids = el.children;
        if (!kids || kids.length === 0) return false;
        for (var i = 0; i < kids.length; i++) {
          var d = '';
          try { d = getComputedStyle(kids[i]).display; } catch (_) { return false; }
          if (d.indexOf('inline') !== 0 && d !== 'contents') return false;
        }
        return true;
      })(),
      lineHeightRatio: (function () {
        var fs = parseFloat(cs.fontSize);
        var lh = parseFloat(cs.lineHeight);
        if (isNaN(fs) || isNaN(lh) || fs <= 0) return 0;
        return Math.round((lh / fs) * 100) / 100;
      })(),
      paddingTopPx: (function () { var n = parseFloat(cs.paddingTop); return isNaN(n) ? 0 : Math.round(n); })(),
      gapPx: (function () { var n = parseFloat(cs.gap || cs.columnGap || ''); return isNaN(n) ? 0 : Math.round(n); })(),
      isFlexOrGrid: cs.display === 'flex' || cs.display === 'grid' || cs.display === 'inline-flex' || cs.display === 'inline-grid',
    };
  }

  // The global corner-radius scale (Tier 3). Tries the inline value on
  // <html> first (where a control edit lands), then the computed value
  // (where the born-canonical :root default lives). null when absent.
  function readRadiusScale() {
    try {
      var root = document.documentElement;
      var v = root.style.getPropertyValue('--ol-r-scale');
      if (!v) v = getComputedStyle(root).getPropertyValue('--ol-r-scale');
      v = (v || '').trim();
      if (!v) return null;
      var n = parseFloat(v);
      return isNaN(n) ? null : n;
    } catch (_) {
      return null;
    }
  }

  // The global display font (Tier 3) — same read pattern as the radius
  // scale. Returns the first family name (de-quoted), or null when absent.
  function readDisplayFont() {
    try {
      var root = document.documentElement;
      var v = root.style.getPropertyValue('--ol-font-display');
      if (!v) v = getComputedStyle(root).getPropertyValue('--ol-font-display');
      v = (v || '').trim();
      if (!v) return null;
      var first = v.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      return first || null;
    } catch (_) {
      return null;
    }
  }

  // The global accent color (Tier 3) — same read pattern as the others.
  // Returns the hex value, or null when absent.
  function readAccent() {
    try {
      var root = document.documentElement;
      var v = root.style.getPropertyValue('--ol-accent');
      if (!v) v = getComputedStyle(root).getPropertyValue('--ol-accent');
      v = (v || '').trim();
      return v || null;
    } catch (_) {
      return null;
    }
  }

  // Global background + text colors (Tier 4) — same read pattern as accent.
  function readBg() {
    try {
      var root = document.documentElement;
      var v = root.style.getPropertyValue('--ol-bg');
      if (!v) v = getComputedStyle(root).getPropertyValue('--ol-bg');
      v = (v || '').trim();
      return v || null;
    } catch (_) {
      return null;
    }
  }
  function readFg() {
    try {
      var root = document.documentElement;
      var v = root.style.getPropertyValue('--ol-fg');
      if (!v) v = getComputedStyle(root).getPropertyValue('--ol-fg');
      v = (v || '').trim();
      return v || null;
    } catch (_) {
      return null;
    }
  }

  function readSurface() {
    try {
      var root = document.documentElement;
      var v = root.style.getPropertyValue('--ol-surface');
      if (!v) v = getComputedStyle(root).getPropertyValue('--ol-surface');
      v = (v || '').trim();
      return v || null;
    } catch (_) {
      return null;
    }
  }
  function readBorder() {
    try {
      var root = document.documentElement;
      var v = root.style.getPropertyValue('--ol-border');
      if (!v) v = getComputedStyle(root).getPropertyValue('--ol-border');
      v = (v || '').trim();
      return v || null;
    } catch (_) {
      return null;
    }
  }

  // Current light/dark mode (Tier 4) — the data-ol-mode attribute on <html>.
  function readMode() {
    try {
      return document.documentElement.getAttribute('data-ol-mode') === 'dark'
        ? 'dark'
        : 'light';
    } catch (_) {
      return 'light';
    }
  }

  // The global type scale (Tier 4) — same read pattern as the radius scale.
  function readTypeScale() {
    try {
      var root = document.documentElement;
      var v = root.style.getPropertyValue('--ol-text-scale');
      if (!v) v = getComputedStyle(root).getPropertyValue('--ol-text-scale');
      v = (v || '').trim();
      if (!v) return null;
      var n = parseFloat(v);
      return isNaN(n) ? null : n;
    } catch (_) {
      return null;
    }
  }

  // The global density scale (Tier 4) — same read pattern as the radius scale.
  function readSpaceScale() {
    try {
      var root = document.documentElement;
      var v = root.style.getPropertyValue('--ol-space-scale');
      if (!v) v = getComputedStyle(root).getPropertyValue('--ol-space-scale');
      v = (v || '').trim();
      if (!v) return null;
      var n = parseFloat(v);
      return isNaN(n) ? null : n;
    } catch (_) {
      return null;
    }
  }

  // Read an --ol-* token's AUTHORED value: the value DECLARED in the page's
  // born-canonical :root token blocks (<style data-ol-*>), independent of any
  // inline <html> override a Look applied. A Look sets inline custom props on
  // <html> and PERSISTS them, so the live/computed value drifts to the Look
  // after a save+reload — but the authored :root blocks are never rewritten,
  // so they stay the page's true original. Returns null when no :root rule
  // declares the token (legacy pages whose color was only ever inline).
  function readAuthoredVar(name) {
    try {
      var found = null;
      var sheets = document.styleSheets;
      for (var i = 0; i < sheets.length; i++) {
        var rules;
        try { rules = sheets[i].cssRules; } catch (_) { continue; }
        if (!rules) continue;
        for (var j = 0; j < rules.length; j++) {
          var r = rules[j];
          if (!r || r.type !== 1) continue; // CSSRule.STYLE_RULE
          var parts = (r.selectorText || '').split(',');
          var isRoot = false;
          for (var k = 0; k < parts.length; k++) {
            var p = parts[k].trim();
            // Exact :root / html only — excludes :root[data-ol-mode="dark"]
            // (its values are the dark look, not the light baseline).
            if (p === ':root' || p === 'html') { isRoot = true; break; }
          }
          if (!isRoot) continue;
          var v = r.style.getPropertyValue(name);
          if (v && v.trim()) found = v.trim(); // last declaration wins (cascade)
        }
      }
      return found;
    } catch (_) {
      return null;
    }
  }
  // A :root-declared scale token as a number, else null.
  function authoredNum(name) {
    var v = readAuthoredVar(name);
    if (v == null) return null;
    var f = parseFloat(v);
    return isNaN(f) ? null : f;
  }
  // The page's AUTHORED theme baseline — what "Original" (↺) re-applies. Read
  // strictly from the :root token blocks so it stays the page's true original
  // even after a Look is applied + persisted + reloaded (the Look only writes
  // inline <html> overrides, never these blocks). A token NOT declared in :root
  // is left null → the reset REMOVES that override rather than pinning a Look
  // value. Exception: --ol-bg / --ol-fg fall back to the live value, because on
  // legacy (non-canonical) pages canonize pins those two inline-only with no
  // :root block, and dropping them would blank the page background.
  function readAuthored() {
    return {
      accent: readAuthoredVar('--ol-accent'),
      bg: readAuthoredVar('--ol-bg') || readBg(),
      surface: readAuthoredVar('--ol-surface'),
      fg: readAuthoredVar('--ol-fg') || readFg(),
      border: readAuthoredVar('--ol-border'),
      displayFont: readAuthoredVar('--ol-font-display'),
      radiusScale: authoredNum('--ol-r-scale'),
      typeScale: authoredNum('--ol-text-scale'),
      spaceScale: authoredNum('--ol-space-scale'),
    };
  }

  function readPageMeta() {
    function content(sel) {
      var m = document.head.querySelector(sel);
      return m ? (m.getAttribute('content') || '') : '';
    }
    var icon = document.head.querySelector('link[rel~="icon"]');
    var titleEl = document.head.querySelector('title');
    return {
      title: titleEl ? (titleEl.textContent || '') : '',
      description: content('meta[name="description"]'),
      ogImage: content('meta[property="og:image"]'),
      favicon: icon ? (icon.getAttribute('href') || '') : '',
      radiusScale: readRadiusScale(),
      typeScale: readTypeScale(),
      spaceScale: readSpaceScale(),
      displayFont: readDisplayFont(),
      accent: readAccent(),
      bg: readBg(),
      surface: readSurface(),
      fg: readFg(),
      border: readBorder(),
      mode: readMode(),
      hasDark: !!document.querySelector('style[data-ol-modes]'),
      hasFontPair: !!document.querySelector('link[data-ol-fonts]'),
      // The page's authored theme — the "Original" reset baseline. Distinct
      // from the live tokens above (which reflect any applied Look).
      authored: readAuthored(),
    };
  }

  function post(msg) {
    try { window.parent.postMessage(msg, '*'); } catch (_) {}
  }

  function postPageMeta() {
    post({ type: 'openlen:page-meta', meta: readPageMeta() });
  }

  function postSelected(el) {
    post({
      type: 'openlen:element-selected',
      path: buildPath(el),
      tag: el.tagName.toLowerCase(),
      hint: buildHint(el),
      props: readProps(el),
      formIndex: formIndexOf(el),
      formId: formIdOf(el),
      style: readStyle(el),
      wasProps: Object.keys(parseStash(el.getAttribute(STASH_ATTR))),
      ancestors: buildAncestors(el),
    });
  }

  function setHover(el) {
    if (hovered && hovered !== el) hovered.removeAttribute('data-openlen-inspect-hover');
    hovered = el;
    if (hovered && hovered !== selected) hovered.setAttribute('data-openlen-inspect-hover', '');
  }

  function setSelected(el) {
    if (selected) selected.removeAttribute('data-openlen-inspect-selected');
    selected = el;
    if (selected) {
      selected.removeAttribute('data-openlen-inspect-hover');
      selected.setAttribute('data-openlen-inspect-selected', '');
    }
  }

  function resolvePath(path) {
    try {
      return document.querySelector('body > ' + path) || document.querySelector(path);
    } catch (_) {
      return null;
    }
  }

  // UN ELEMENTO, no el documento entero.
  //
  // postClean, aqui abajo, clona el documento VIVO, y esa es la practica que
  // obliga a congelar el JavaScript del modelo mientras se edita: con el script
  // corriendo, todo lo que hubiera hecho se persistiria como la pagina del
  // usuario. Esto manda solo el elemento que el inspector toco.
  //
  // Se usa en los cambios de UN elemento (una propiedad, un estilo, un fondo,
  // ocultar, un enlace). Los cambios GLOBALES -tema, tipografias, tematica,
  // metadatos de la pagina- siguen por postClean de momento: tocan el <head>,
  // el :root y la clase del <html>, que no son un elemento del cuerpo y no se
  // pueden nombrar con una ruta posicional.
  function postEdicion(el) {
    if (!el || !el.parentElement) return;
    var clone = el.cloneNode(true);
    for (var i = 0; i < EDITOR_NODE_ATTRS.length; i++) {
      clone.removeAttribute(EDITOR_NODE_ATTRS[i]);
    }
    clone.removeAttribute('data-openlen-inspect-hover');
    clone.removeAttribute('data-openlen-inspect-selected');
    clone.querySelectorAll('[data-openlen-inspect-hover]').forEach(function (n) {
      n.removeAttribute('data-openlen-inspect-hover');
    });
    clone.querySelectorAll('[data-openlen-inspect-selected]').forEach(function (n) {
      n.removeAttribute('data-openlen-inspect-selected');
    });
    post({
      type: 'openlen:edit',
      op: 'replace',
      path: buildEditPath(el),
      tag: el.tagName.toLowerCase(),
      hijos: editChildTags(el),
      html: clone.outerHTML,
      source: 'props'
    });
  }

  // EL ELEMENTO RAIZ. El selector de tema no cambia nada del cuerpo: escribe en
  // <html> -su style inline, que lleva los tokens --ol-*, y su data-ol-mode-.
  // Es UN elemento, solo que fuera del body, asi que no tiene ruta posicional y
  // viaja por su propia operacion.
  //
  // Se mandan SOLO los dos atributos que este inspector toca. El lang, la clase
  // que puso el normalizador y lo demas se quedan donde estan: mandar el
  // conjunto entero convertiria un cambio de acento en una reescritura de la
  // raiz.
  function postRaiz() {
    var root = document.documentElement;
    var estilo = root.getAttribute('style');
    var modo = root.getAttribute('data-ol-mode');
    post({
      type: 'openlen:edit',
      op: 'attrs_raiz',
      attrs: {
        style: estilo === null ? null : estilo,
        'data-ol-mode': modo === null ? null : modo
      },
      source: 'props'
    });
  }

  // LA CABEZA. El <link> de una tipografia, el <style> de una tematica. Los que
  // llevan ese atributo se quitan antes de poner los nuevos: applyHeadOp solo
  // reemplaza <title> y <meta name>, asi que un <link> cuyo href cambia se
  // añadiria al lado del anterior y la pagina cargaria las dos tipografias.
  function postCabeza(html, attr) {
    post({
      type: 'openlen:edit',
      op: 'cabeza',
      html: html || '',
      reemplazarPorAtributo: attr || undefined,
      source: 'props'
    });
  }

  // COMO SE LLAMA UN ELEMENTO, capturado ANTES de tocarlo.
  //
  // Un borrado tiene un problema que las demas ediciones no: cuando quieres
  // nombrar el elemento, ya no esta. La ruta y la firma se toman antes de
  // mutar, y el servidor las resuelve contra el documento guardado, que
  // todavia lo tiene.
  function descriptorDe(el) {
    if (!el || !el.parentElement) return null;
    return {
      path: buildEditPath(el),
      tag: el.tagName.toLowerCase(),
      hijos: editChildTags(el)
    };
  }

  function postBorrado(desc) {
    if (!desc) return;
    post({
      type: 'openlen:edit',
      op: 'delete',
      path: desc.path,
      tag: desc.tag,
      hijos: desc.hijos,
      source: 'props'
    });
  }

  // Serialize the live document, stripped of inspect instrumentation, and
  // hand it to the parent for persistence — same contract the Replace
  // surface uses.
  function postClean() {
    var clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('[data-openlen-inspect]').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('[data-openlen-3d-preview]').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('[data-openlen-inspect-hover]').forEach(function (n) {
      n.removeAttribute('data-openlen-inspect-hover');
    });
    clone.querySelectorAll('[data-openlen-inspect-selected]').forEach(function (n) {
      n.removeAttribute('data-openlen-inspect-selected');
    });
    var b = clone.querySelector('body');
    if (b) {
      b.removeAttribute('data-openlen-inspect-mode');
      // The edit-mode flag is editor-only — it must never reach the saved /
      // published HTML, or the persistent hide rule (scoped to :not(edit-mode))
      // would think the published page is "in edit mode" and skip hiding.
      b.removeAttribute('data-openlen-edit-mode');
    }
    post({
      type: 'openlen:html-changed',
      outerHtml: '<!doctype html>\\n' + clone.outerHTML,
      source: 'props',
    });
  }

  function applyElementProp(path, name, value) {
    var el = resolvePath(path);
    if (!el) return;
    if (value === null || value === '') {
      el.removeAttribute(name);
    } else {
      el.setAttribute(name, value);
    }
    // A new-tab link without rel=noopener is a tab-nabbing footgun — keep
    // the two attributes in lockstep so the panel never emits unsafe HTML.
    if (name === 'target') {
      if (value === '_blank') {
        el.setAttribute('rel', 'noopener noreferrer');
      } else {
        var rel = (el.getAttribute('rel') || '')
          .replace(/\\b(noopener|noreferrer)\\b/g, '')
          .replace(/\\s+/g, ' ')
          .trim();
        if (rel) el.setAttribute('rel', rel);
        else el.removeAttribute('rel');
      }
    }
    postEdicion(el);
    if (selected === el) postSelected(el);
  }

  // Un <button> que no envía un formulario no hace NADA — es lo que el contrato
  // de diseño ya le dice al modelo. Cuando el usuario le pone un destino en el
  // inspector, lo convertimos en el <a> que debió ser: mismas clases, mismo
  // contenido, mismo aspecto. Es lo que sustituye al módulo de Pedidos — pones
  // tu WhatsApp, tu Telegram o tu enlace de pago y el botón lleva ahí.
  //
  // NUNCA dentro de un <form>: ahí el botón sí tiene trabajo (enviar), y
  // convertirlo rompería el formulario en silencio.
  function applyLinkifyButton(path, href) {
    var el = resolvePath(path);
    if (!el || el.tagName.toLowerCase() !== 'button') return;
    if (el.closest && el.closest('form')) return;
    var a = document.createElement('a');
    for (var i = 0; i < el.attributes.length; i++) {
      var at = el.attributes[i];
      // Atributos que sólo significan algo en un <button>: arrastrarlos dejaría
      // marcado sin sentido en el HTML publicado.
      if (at.name === 'type' || at.name === 'disabled' || at.name === 'name'
        || at.name === 'value' || at.name === 'form') continue;
      a.setAttribute(at.name, at.value);
    }
    while (el.firstChild) a.appendChild(el.firstChild);
    a.setAttribute('href', href);
    el.parentNode.replaceChild(a, el);
    // La ruta lleva el nombre de etiqueta (button:nth-of-type(n)), así que al
    // convertir deja de resolver. Re-seleccionar es obligatorio o el panel
    // seguiría apuntando a un elemento que ya no existe.
    if (selected === el) {
      selected = a;
      postSelected(a);
    }
    postEdicion(a);
  }

  function applyPageMeta(field, value) {
    var head = document.head;
    if (!head) return;
    if (field === 'title') {
      var t = head.querySelector('title');
      if (!t) { t = document.createElement('title'); head.appendChild(t); }
      t.textContent = value;
    } else if (field === 'description' || field === 'ogImage') {
      var isOg = field === 'ogImage';
      var sel = isOg ? 'meta[property="og:image"]' : 'meta[name="description"]';
      var m = head.querySelector(sel);
      if (!value) {
        if (m) m.remove();
      } else {
        if (!m) {
          m = document.createElement('meta');
          if (isOg) m.setAttribute('property', 'og:image');
          else m.setAttribute('name', 'description');
          head.appendChild(m);
        }
        m.setAttribute('content', value);
      }
    } else if (field === 'favicon') {
      var link = head.querySelector('link[rel~="icon"]');
      if (!value) {
        if (link) link.remove();
      } else {
        if (!link) {
          link = document.createElement('link');
          link.setAttribute('rel', 'icon');
          head.appendChild(link);
        }
        link.setAttribute('href', value);
      }
    } else {
      return;
    }
    // El nodo TAL Y COMO HA QUEDADO, acotando el reemplazo por atributo Y
    // valor: property a secas se llevaria por delante todas las etiquetas
    // Open Graph de la pagina. Vacio = borrar, que es lo que hace el inspector
    // cuando el usuario deja el campo en blanco.
    var CLAVE = {
      title: ['title', 'title'],
      description: ['meta[name="description"]', 'name=description'],
      ogImage: ['meta[property="og:image"]', 'property=og:image'],
      favicon: ['link[rel~="icon"]', 'rel=icon']
    };
    var par = CLAVE[field];
    if (par) {
      var vivo = head.querySelector(par[0]);
      postCabeza(vivo ? vivo.outerHTML : '', par[1]);
    }
    postPageMeta();
  }

  // Merge one CSS property into the element's inline style — inline style
  // wins the cascade, so the change always lands. Empty value removes it.
  function applyStyle(path, prop, value) {
    var el = resolvePath(path);
    if (!el) return;
    stashProp(el, prop);
    if (value) el.style.setProperty(prop, value);
    else el.style.removeProperty(prop);
    postEdicion(el);
    if (selected === el) postSelected(el);
  }

  // Smart background — works on ANY element (divs included), so decorative
  // CSS blocks become image-filled or solid without DOM surgery.
  //  kind 'color': solid color that WINS over any gradient/image (sets
  //                background-image:none so the colour is actually visible).
  //  kind 'image': fill the element's box with a picture (cover/center).
  //                Optional leg = { ink, scrimColor, groundLum } (drop engine):
  //                scrimColor layers a darkening gradient under the text, ink +
  //                groundLum drive a scoped contrast re-ink of the subtree.
  //  kind 'clear': drop the fill image, revert to the underlying paint.
  function applyBg(path, kind, value, leg) {
    var el = resolvePath(path);
    if (!el) return;
    var bgProps = kind === 'color'
      ? ['background-color', 'background-image']
      : ['background-image', 'background-size', 'background-position', 'background-repeat'];
    for (var bi = 0; bi < bgProps.length; bi++) stashProp(el, bgProps[bi]);
    if (kind === 'color') {
      if (value) {
        el.style.setProperty('background-color', value);
        el.style.setProperty('background-image', 'none');
      } else {
        // Clearing the colour only drops the colour — it must NOT wipe an
        // image fill (that's what the dedicated "Remove image" / kind:'clear'
        // is for). Keeping them separate prevents silent image loss.
        el.style.removeProperty('background-color');
      }
    } else if (kind === 'image' && value) {
      var bgVal = 'url("' + value + '")';
      if (leg && typeof leg.scrimColor === 'string' && leg.scrimColor) {
        bgVal = 'linear-gradient(' + leg.scrimColor + ', ' + leg.scrimColor + '), ' + bgVal;
      }
      el.style.setProperty('background-image', bgVal);
      el.style.setProperty('background-size', 'cover');
      el.style.setProperty('background-position', 'center');
      el.style.setProperty('background-repeat', 'no-repeat');
      if (leg && typeof leg.ink === 'string' && leg.ink && typeof leg.groundLum === 'number') {
        olReinkScoped(el, leg.groundLum, leg.ink);
      }
    } else if (kind === 'gradient' && value) {
      // The editor passes a full CSS gradient string — set it directly (no
      // url() wrapper); background-color stays underneath (the gradient
      // covers it) and size/position are irrelevant for gradients.
      el.style.setProperty('background-image', value);
      if (leg && typeof leg.ink === 'string' && leg.ink && typeof leg.groundLum === 'number') {
        olReinkScoped(el, leg.groundLum, leg.ink);
      }
    } else if (kind === 'clear') {
      el.style.removeProperty('background-image');
      el.style.removeProperty('background-size');
      el.style.removeProperty('background-position');
      el.style.removeProperty('background-repeat');
      // A bg drop may have re-inked this subtree's text for the removed
      // ground — put the original colors back or light text strands on a
      // light page.
      olRestoreReinkIn(el);
    }
    postEdicion(el);
    if (selected === el) postSelected(el);
  }

  // Swap two page images (the drag-an-image-onto-another gesture). Sizes and
  // classes stay with their slots — only src + alt travel, which is what
  // keeps both layouts intact.
  // Dos elementos intercambiados son DOS ediciones. Las rutas no cambian -cada
  // uno sigue donde estaba- lo que cambia es que hay en cada sitio.
  function applySwapImages(pathA, pathB) {
    var a = resolvePath(pathA);
    var b = resolvePath(pathB);
    if (!a || !b || a === b) return;
    if (a.tagName !== 'IMG' || b.tagName !== 'IMG') return;
    var srcA = a.getAttribute('src') || '';
    var altA = a.getAttribute('alt');
    a.setAttribute('src', b.getAttribute('src') || '');
    var altB = b.getAttribute('alt');
    if (altB !== null) a.setAttribute('alt', altB);
    else a.removeAttribute('alt');
    b.setAttribute('src', srcA);
    if (altA !== null) b.setAttribute('alt', altA);
    else b.removeAttribute('alt');
    // DOS elementos intercambiados son DOS ediciones. Las rutas no cambian
    // -cada uno sigue donde estaba-; lo que cambia es que hay en cada sitio.
    postEdicion(a);
    postEdicion(b);
  }

  // Remove a dropped image / video — the inverse of each drop target:
  //   split media cell   → un-split (media out, copy cell unwrapped, grid off)
  //   bg-filled div      → clear the fill + restore re-inked text
  //   plain <img>/<video> → remove it; a section left with no real content (the
  //                        drop-created media section) goes with it
  function applyRemoveImage(path) {
    var el = resolvePath(path);
    if (!el) return;
    var media = el.closest ? el.closest('.ol-split-media') : null;
    // Las tres ramas de abajo son tres ediciones DISTINTAS, y esta es la unica
    // que lo tiene dificil: hay que nombrar lo que se va antes de que se vaya.
    var descEl = descriptorDe(el);
    var seccionDeEl = el.closest
      ? el.closest('section, header, footer, article, aside')
      : null;
    var descSeccion = descriptorDe(seccionDeEl);
    if (media && media.parentElement && media.parentElement.classList.contains('ol-split')) {
      var container = media.parentElement;
      container.removeChild(media);
      // Unwrap OUR classless copy wrapper so the section returns to its
      // original markup; an authored cell (carries classes) is left alone.
      var copy = container.firstElementChild;
      if (
        copy &&
        copy.tagName === 'DIV' &&
        !copy.getAttribute('class') &&
        container.children.length === 1
      ) {
        while (copy.firstChild) container.insertBefore(copy.firstChild, copy);
        container.removeChild(copy);
      }
      container.classList.remove('ol-split');
      if (!container.getAttribute('class')) container.removeAttribute('class');
      // Deshacer la particion no borra: deja el contenedor con otro contenido.
      postEdicion(container);
    } else if (el.tagName === 'IMG' || el.tagName === 'VIDEO') {
      // Real media element (dropped <img> or a video/motion hero) → remove it,
      // and drop the host section if that leaves it with no text or media.
      var section = seccionDeEl;
      if (el.parentNode) el.parentNode.removeChild(el);
      var seFueLaSeccion = false;
      if (section && section.isConnected) {
        var hasText = /\\S/.test(section.textContent || '');
        var hasMedia = !!section.querySelector('img, svg, video, iframe, picture');
        if (!hasText && !hasMedia && section.parentNode) {
          section.parentNode.removeChild(section);
          seFueLaSeccion = true;
        }
      }
      // Si la seccion se quedo sin nada y se fue con la imagen, lo que hay que
      // borrar en el documento guardado es LA SECCION: borrar solo la imagen
      // dejaria una seccion vacia en la pagina publicada que en el taller ya no
      // se ve. Su firma se capturo antes, cuando todavia tenia la imagen dentro
      // -que es como el documento guardado la tiene-.
      postBorrado(seFueLaSeccion ? descSeccion : descEl);
    } else {
      el.style.removeProperty('background-image');
      el.style.removeProperty('background-size');
      el.style.removeProperty('background-position');
      el.style.removeProperty('background-repeat');
      olRestoreReinkIn(el);
      // Quitar el relleno no borra el elemento: lo deja sin fondo.
      postEdicion(el);
    }
    if (selected && !selected.isConnected) {
      selected = null;
      post({ type: 'openlen:element-deselected' });
    }
  }

  // Inject (once) the persistent rule that hides data-ol-hidden elements
  // everywhere the editor isn't active — i.e. preview + the published page.
  // It carries NO inspect marker, so postClean keeps it in the saved HTML.
  // Scoped to :not(edit-mode) so the element keeps its natural display while
  // editing (the INSPECT_STYLE dims it instead). postClean strips the
  // edit-mode attr from <body>, so the published page always matches → hides.
  function ensureHiddenStyle() {
    if (document.querySelector('style[data-ol-hidden-style]')) return;
    var s = document.createElement('style');
    s.setAttribute('data-ol-hidden-style', '');
    s.textContent =
      'body:not([data-openlen-edit-mode]) [data-ol-hidden]{display:none !important;}';
    document.head.appendChild(s);
  }

  // Hide / show an element. Reversible by design: hiding only tags the element
  // (no inline display:none), so it stays selectable (dimmed) in the editor and
  // the toggle can un-hide it.
  function applyHide(path, on) {
    var el = resolvePath(path);
    if (!el) return;
    if (on) {
      el.setAttribute('data-ol-hidden', '');
      ensureHiddenStyle();
      // La hoja que hace efectiva la marca. Va como edicion de cabeza porque
      // no vive en el cuerpo, y se manda ANTES que el elemento: sin ella, el
      // atributo no esconde nada en la pagina publicada.
      var hoja = document.querySelector('style[data-ol-hidden-style]');
      if (hoja) postCabeza(hoja.outerHTML, 'data-ol-hidden-style');
    } else {
      el.removeAttribute('data-ol-hidden');
    }
    postEdicion(el);
    if (selected === el) postSelected(el);
  }

  // Page-level theme tokens (Tier 3) — set as inline custom properties on
  // <html>; they override the :root defaults and persist with the document.
  function hexTriplet(hex) {
    var m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(('' + hex).trim());
    if (!m) return null;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return (
      parseInt(h.slice(0, 2), 16) +
      ',' +
      parseInt(h.slice(2, 4), 16) +
      ',' +
      parseInt(h.slice(4, 6), 16)
    );
  }
  // Apply a whole theme preset at once — a {token: value} bundle — with a
  // single reclean + repost so the "look" lands atomically.
  function applyThemeBundle(tokens) {
    var root = document.documentElement;
    for (var k in tokens) {
      if (!Object.prototype.hasOwnProperty.call(tokens, k)) continue;
      var v = tokens[k];
      if (k === 'data-ol-mode') {
        if (v) root.setAttribute('data-ol-mode', v);
        else root.removeAttribute('data-ol-mode');
      } else if (v === null || v === '') {
        root.style.removeProperty(k);
      } else {
        root.style.setProperty(k, v);
        if (k === '--ol-accent') {
          var trip = hexTriplet(v);
          if (trip) root.style.setProperty('--ol-accent-r', trip);
        }
      }
    }
    postRaiz();
    postPageMeta();
  }

  // Temática — install/remove a kit's full-page world. The kit's stylesheet
  // (backdrop + scrim + glass + ink, built by lib/tematicas/presets.ts) and
  // its display-font <link> land as data-ol-tematica-TAGGED elements in
  // <head>, plus the kit id stamped on <html>. These PERSIST in the saved
  // document (same model as the Looks inline vars — the page must carry its
  // world in thumbnails/exports/published, not only in the editor). The
  // parent applies the kit's token bundle separately via theme-bundle.

  // Contrast re-ink — the deterministic "acomodar" pass. The kit CSS re-inks
  // block text but deliberately leaves spans/links/divs alone so intentional
  // accent words survive; on an ink-direction flip (dark page → light world)
  // those keep their old-world colors and go illegible. This pass measures
  // every text-bearing element's computed color against the NEW world's
  // grounds and re-inks only what fails: saturated colors (the page's old
  // accent) become var(--ol-accent), neutrals become var(--ol-fg). Originals
  // are stashed in data-ol-reink so removing/switching the world restores
  // them exactly.
  function olLum(r, g, b) {
    function lin(c) {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  function olCr(l1, l2) {
    var hi = Math.max(l1, l2);
    var lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }
  function olParse(c) {
    var m = /rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.]+))?\\s*\\)/.exec('' + c);
    if (m) {
      return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    }
    var h = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(('' + c).trim());
    if (!h) return null;
    var s = h[1];
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
      a: 1,
    };
  }
  function olRestoreReink() {
    var els = document.querySelectorAll('[data-ol-reink]');
    for (var i = 0; i < els.length; i++) {
      var prev = els[i].getAttribute('data-ol-reink');
      if (prev) els[i].style.color = prev;
      else els[i].style.removeProperty('color');
      els[i].removeAttribute('data-ol-reink');
    }
  }
  // Scoped restore — undoes a per-section re-ink pass (bg clear / re-drop /
  // image removal) without touching the rest of the page.
  function olRestoreReinkIn(rootEl) {
    if (!rootEl || !rootEl.querySelectorAll) return;
    var list = [rootEl];
    var els = rootEl.querySelectorAll('[data-ol-reink]');
    for (var i = 0; i < els.length; i++) list.push(els[i]);
    for (var j = 0; j < list.length; j++) {
      var el = list[j];
      if (!el.getAttribute || el.getAttribute('data-ol-reink') === null) continue;
      var prev = el.getAttribute('data-ol-reink');
      if (prev) el.style.color = prev;
      else el.style.removeProperty('color');
      el.removeAttribute('data-ol-reink');
    }
  }
  function olReinkForWorld(tokens) {
    var bg = olParse(tokens['--ol-bg']);
    var surface = olParse(tokens['--ol-surface']);
    if (!bg || !surface) return;
    var bgL = olLum(bg.r, bg.g, bg.b);
    var surfaceL = olLum(surface.r, surface.g, surface.b);
    var all = document.body ? document.body.querySelectorAll('*') : [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.namespaceURI && el.namespaceURI.indexOf('svg') > -1) continue;
      var tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'AUDIO') continue;
      if (el.closest && el.closest('[data-openlen-music-preview],[data-openlen-edit-overlay]')) continue;
      // Only elements that directly carry text.
      var hasText = false;
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3 && /\\S/.test(n.nodeValue)) { hasText = true; break; }
      }
      if (!hasText) continue;
      var cs;
      try { cs = getComputedStyle(el); } catch (_) { continue; }
      // Gradient/clipped text paints from background-image, not color.
      if ((cs.webkitBackgroundClip || cs.backgroundClip) === 'text') continue;
      var col = olParse(cs.color);
      if (!col || col.a < 0.5) continue;
      var L = olLum(col.r, col.g, col.b);
      // Readable on either ground (page scrim or glass card)? Leave it.
      if (olCr(L, bgL) >= 3 || olCr(L, surfaceL) >= 3) continue;
      if (!el.getAttribute('data-ol-reink')) {
        el.setAttribute('data-ol-reink', el.style.color || '');
      }
      var chroma = Math.max(col.r, col.g, col.b) - Math.min(col.r, col.g, col.b);
      el.style.setProperty(
        'color',
        chroma > 50 ? 'var(--ol-accent)' : 'var(--ol-fg)',
        'important',
      );
    }
  }

  // Media split (drop engine) — persistent, marker-free stylesheet so the
  // layout ships with the page (same pattern as ensureHiddenStyle). Mobile
  // stacks the cells; md+ goes two columns.
  function ensureSplitStyle() {
    if (document.querySelector('style[data-ol-split-style]')) return;
    var s = document.createElement('style');
    s.setAttribute('data-ol-split-style', '');
    s.textContent =
      '.ol-split{display:grid;grid-template-columns:1fr;gap:2rem;align-items:center;}' +
      '@media (min-width:768px){.ol-split{grid-template-columns:1fr 1fr;}}' +
      '.ol-split>*{min-width:0;}' +
      '.ol-split-media{margin:0;}' +
      '.ol-split-media>img{display:block;width:100%;height:auto;max-height:480px;object-fit:cover;border-radius:12px;}';
    (document.head || document.documentElement).appendChild(s);
  }

  // Split a text section into copy + image columns: the container's children
  // move into a copy cell, the image lands as the first (left) or last
  // (right) cell. Uses the SAME splitContainer the drop script's canSplit
  // ran, so the detected target and the transformed element always match.
  function applySplit(path, side, url, alt) {
    var el = resolvePath(path);
    if (!el) return;
    var container = splitContainer(el);
    if (!container) return;
    if (container.classList && container.classList.contains('ol-split')) return;
    ensureSplitStyle();
    var copy = document.createElement('div');
    while (container.firstChild) copy.appendChild(container.firstChild);
    var media = document.createElement('div');
    media.className = 'ol-split-media';
    var img = document.createElement('img');
    img.setAttribute('src', url);
    img.setAttribute('alt', alt || '');
    img.setAttribute('loading', 'lazy');
    media.appendChild(img);
    container.appendChild(copy);
    if (side === 'left') container.insertBefore(media, copy);
    else container.appendChild(media);
    container.classList.add('ol-split');
    // El contenedor nuevo ocupa el sitio que tenia el elemento, asi que su
    // ruta es la que el servidor tiene que resolver.
    postEdicion(container);
    if (selected === el) postSelected(el);
  }

  // Scoped re-ink for ONE section that just got an image background (the drop
  // engine's "World per-section"). Measures text against the section's new
  // ground luminance (scrim-attenuated, composed parent-side) and re-inks what
  // fails with ONE concrete ink — saturated "accent" text on a photo is just
  // as unreadable as neutral text, so there is no accent split here. Restores
  // any prior pass within the subtree first, so a re-drop re-measures the true
  // originals. Same data-ol-reink stash as the world pass (persists in saved
  // HTML by design).
  function olReinkScoped(rootEl, groundLum, ink) {
    if (!rootEl || typeof groundLum !== 'number') return;
    // Re-drops re-measure from the true originals.
    olRestoreReinkIn(rootEl);
    var all = rootEl.querySelectorAll('*');
    var list = [rootEl];
    for (var q = 0; q < all.length; q++) list.push(all[q]);
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.namespaceURI && el.namespaceURI.indexOf('svg') > -1) continue;
      var tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'AUDIO') continue;
      if (el.closest && el.closest('[data-openlen-music-preview],[data-openlen-edit-overlay]')) continue;
      // Only elements that directly carry text.
      var hasText = false;
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3 && /\\S/.test(n.nodeValue)) { hasText = true; break; }
      }
      if (!hasText) continue;
      var cs;
      try { cs = getComputedStyle(el); } catch (_) { continue; }
      // Gradient/clipped text paints from background-image, not color.
      if ((cs.webkitBackgroundClip || cs.backgroundClip) === 'text') continue;
      var col = olParse(cs.color);
      if (!col || col.a < 0.5) continue;
      var L = olLum(col.r, col.g, col.b);
      if (olCr(L, groundLum) >= 3) continue;
      if (!el.getAttribute('data-ol-reink')) {
        el.setAttribute('data-ol-reink', el.style.color || '');
      }
      el.style.setProperty('color', ink, 'important');
    }
  }

  // EL ULTIMO CAMINO DE ESTE FICHERO QUE MANDA EL DOCUMENTO ENTERO, y no por
  // pereza: por olReinkForWorld / olRestoreReink.
  //
  // Esas dos pasadas recorren TODO el cuerpo midiendo el color computado de
  // cada elemento contra los fondos del mundo nuevo, y re-entintan los que no
  // se leerian. Es una decision que solo el navegador puede tomar -el color
  // computado no esta en el HTML- y toca decenas de elementos a la vez.
  //
  // La salida, cuando toque: que las dos pasadas DEVUELVAN los elementos que
  // tocaron y se mande una edicion por cada uno. Son ediciones normales, de un
  // elemento, y el aplicador ya sabe encadenarlas; lo unico que hay que subir
  // es el techo de 100 por lote. Mientras tanto, este camino es la razon por la
  // que el taller sigue pausando el JavaScript del modelo: ver
  // guardar-sin-leer-el-lienzo.test.ts.
  function applyTematica(id, css, fontHref, bg, tokens) {
    var root = document.documentElement;
    var old = document.querySelectorAll('style[data-ol-tematica],link[data-ol-tematica]');
    for (var i = 0; i < old.length; i++) old[i].remove();
    // Always undo a prior pass first — switching kits re-measures fresh,
    // removing the kit restores the page's own colors exactly.
    olRestoreReink();
    if (!id) {
      root.removeAttribute('data-ol-tematica');
      root.removeAttribute('data-ol-tematica-bg');
      postClean();
      postPageMeta();
      return;
    }
    root.setAttribute('data-ol-tematica', id);
    if (bg) root.setAttribute('data-ol-tematica-bg', bg);
    else root.removeAttribute('data-ol-tematica-bg');
    var head = document.head || document.documentElement;
    if (fontHref) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = fontHref;
      l.setAttribute('data-ol-tematica', '');
      head.appendChild(l);
    }
    var s = document.createElement('style');
    s.setAttribute('data-ol-tematica', '');
    s.textContent = css || '';
    head.appendChild(s);
    if (tokens && typeof tokens === 'object') olReinkForWorld(tokens);
    postClean();
    postPageMeta();
  }

  // Par de fuentes curado — el <link> persiste EN el documento (data-ol-fonts,
  // mismo modelo que el font-link de temáticas) y las familias aterrizan como
  // inline vars en <html>. Strings vacíos = quitar el par (vuelve el autorado).
  function applyFonts(displayCss, bodyCss, href) {
    var root = document.documentElement;
    var old = document.querySelectorAll('link[data-ol-fonts]');
    for (var i = 0; i < old.length; i++) old[i].remove();
    if (href) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.setAttribute('data-ol-fonts', '');
      (document.head || document.documentElement).appendChild(l);
    }
    if (displayCss) root.style.setProperty('--ol-font-display', displayCss);
    else root.style.removeProperty('--ol-font-display');
    if (bodyCss) root.style.setProperty('--ol-font-body', bodyCss);
    else root.style.removeProperty('--ol-font-body');
    // Dos ediciones: la hoja de la tipografia y los tokens que la nombran.
    var puesto = document.querySelector('link[data-ol-fonts]');
    postCabeza(puesto ? puesto.outerHTML : '', 'data-ol-fonts');
    postRaiz();
    postPageMeta();
  }

  function applyTheme(prop, value) {
    var root = document.documentElement;
    // The light/dark toggle is an attribute on <html>, not a CSS variable.
    if (prop === 'data-ol-mode') {
      if (value) root.setAttribute('data-ol-mode', value);
      else root.removeAttribute('data-ol-mode');
      postRaiz();
      postPageMeta();
      return;
    }
    if (value === null || value === '') root.style.removeProperty(prop);
    else root.style.setProperty(prop, value);
    // The accent control sets the hex; keep --ol-accent-r (the rgb triplet
    // the rewritten rgba() glows use) in sync from it.
    if (prop === '--ol-accent' && value) {
      var trip = hexTriplet(value);
      if (trip) root.style.setProperty('--ol-accent-r', trip);
    }
    postRaiz();
    postPageMeta();
  }

  // Editor V3 — gate interaction handlers on body[data-openlen-edit-mode].
  // The script is permanently in the persistent iframe; activation is a
  // body-attr flip the parent owns. mouseleave runs always so a stale hover
  // attr left behind by a mid-toggle gets cleared as soon as the cursor
  // leaves the iframe.
  function inEditMode() {
    return !!(document.body && document.body.hasAttribute('data-openlen-edit-mode'));
  }

  document.addEventListener('mousemove', function (e) {
    if (!inEditMode()) return;
    var t = resolveTarget(e.target);
    if (!selectable(t)) { setHover(null); return; }
    setHover(t);
  }, true);

  document.addEventListener('mouseleave', function () { setHover(null); }, true);

  document.addEventListener('click', function (e) {
    if (!inEditMode()) return;
    e.preventDefault();
    e.stopPropagation();
    var t = resolveTarget(e.target);
    if (!selectable(t)) return;
    setSelected(t);
    postSelected(t);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!inEditMode()) return;
    setSelected(null);
    post({ type: 'openlen:element-deselected' });
  }, true);

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || d.type !== 'openlen:apply-prop') return;
    if (d.scope === 'element' && typeof d.path === 'string' && typeof d.name === 'string') {
      applyElementProp(d.path, d.name, d.value === undefined ? null : d.value);
    } else if (d.scope === 'linkify-button' && typeof d.path === 'string' && typeof d.href === 'string') {
      applyLinkifyButton(d.path, d.href);
    } else if (d.scope === 'page' && typeof d.field === 'string') {
      applyPageMeta(d.field, typeof d.value === 'string' ? d.value : '');
    } else if (d.scope === 'style' && typeof d.path === 'string' && typeof d.prop === 'string') {
      applyStyle(d.path, d.prop, typeof d.value === 'string' ? d.value : '');
    } else if (d.scope === 'style-bg' && typeof d.path === 'string' && typeof d.kind === 'string') {
      applyBg(
        d.path,
        d.kind,
        typeof d.value === 'string' ? d.value : '',
        d.legibility && typeof d.legibility === 'object' ? d.legibility : null,
      );
    } else if (d.scope === 'split' && typeof d.path === 'string' && typeof d.url === 'string') {
      applySplit(
        d.path,
        d.side === 'right' ? 'right' : 'left',
        d.url,
        typeof d.alt === 'string' ? d.alt : '',
      );
    } else if (
      d.scope === 'swap-images' &&
      typeof d.fromPath === 'string' &&
      typeof d.toPath === 'string'
    ) {
      applySwapImages(d.fromPath, d.toPath);
    } else if (d.scope === 'remove-image' && typeof d.path === 'string') {
      applyRemoveImage(d.path);
    } else if (d.scope === 'hide' && typeof d.path === 'string') {
      applyHide(d.path, !!d.on);
    } else if (d.scope === 'theme' && typeof d.prop === 'string') {
      applyTheme(d.prop, typeof d.value === 'string' ? d.value : '');
    } else if (d.scope === 'theme-bundle' && d.tokens && typeof d.tokens === 'object') {
      applyThemeBundle(d.tokens);
    } else if (d.scope === 'tematica') {
      applyTematica(
        typeof d.id === 'string' ? d.id : '',
        typeof d.css === 'string' ? d.css : '',
        typeof d.fontHref === 'string' ? d.fontHref : '',
        typeof d.bg === 'string' ? d.bg : '',
        d.tokens && typeof d.tokens === 'object' ? d.tokens : null,
      );
    } else if (d.scope === 'fonts') {
      applyFonts(
        typeof d.displayCss === 'string' ? d.displayCss : '',
        typeof d.bodyCss === 'string' ? d.bodyCss : '',
        typeof d.href === 'string' ? d.href : '',
      );
    } else if (d.scope === 'reset' && typeof d.path === 'string' && Array.isArray(d.props)) {
      applyReset(d.path, d.props.filter(function (p) { return typeof p === 'string'; }));
    } else if (d.scope === 'select' && typeof d.path === 'string') {
      var selEl = resolvePath(d.path);
      if (selEl) { setSelected(selEl); postSelected(selEl); }
    }
  });

  // Canonize-at-runtime — makes --ol-bg + --ol-fg AUTHORITATIVE on ANY HTML
  // (legacy / Tailwind utility / hardcoded). Reads body's computed bg + fg,
  // pins them as :root tokens (only if not already set), and injects an
  // override stylesheet that forces html/body to read them via var(). After
  // this runs, clicking a Theme palette actually re-tints the page, even on
  // pre-canonical templates. data-ol-force persists in saved HTML (the
  // postClean strip-list only removes data-openlen-inspect markers).
  // Find the topmost element under <html> that carries a non-transparent
  // background — body for most pages, but for Tailwind-style templates the
  // bg lives on a wrapper div (<body><div class="bg-white min-h-screen">…).
  // Returns body as a safe fallback.
  function findBgCarrier() {
    if (rgbToHex(getComputedStyle(document.body).backgroundColor)) return document.body;
    var cur = document.body.firstElementChild;
    while (cur) {
      if (rgbToHex(getComputedStyle(cur).backgroundColor)) return cur;
      // Step inside if no child of body itself carries a bg
      if (!cur.nextElementSibling && cur.firstElementChild) {
        cur = cur.firstElementChild;
        continue;
      }
      cur = cur.nextElementSibling;
    }
    return document.body;
  }

  // Tag the carrier so we can target it from a single CSS rule by attribute
  // (works without knowing its tag / class chain).
  function canonizeAtRuntime() {
    if (!document.body) return;
    if (document.querySelector('style[data-ol-force]')) return;
    var root = document.documentElement;
    var carrier = findBgCarrier();
    var bg = root.style.getPropertyValue('--ol-bg');
    var fg = root.style.getPropertyValue('--ol-fg');
    if (!bg) bg = rgbToHex(getComputedStyle(carrier).backgroundColor);
    if (!fg) fg = rgbToHex(getComputedStyle(document.body).color);
    // Can't determine the page's current palette — leave it alone (no force
    // CSS, no token set; the page renders as it always has).
    if (!bg || !fg) return;
    root.style.setProperty('--ol-bg', bg);
    root.style.setProperty('--ol-fg', fg);
    carrier.setAttribute('data-ol-bg-carrier', '');
    var s = document.createElement('style');
    s.setAttribute('data-ol-force', '');
    // Force three layers: html (root), body (default carrier), and the
    // detected actual carrier (catches the Tailwind wrapper pattern).
    s.textContent =
      'html,body,[data-ol-bg-carrier]{background-color:var(--ol-bg) !important;}' +
      'html,body{color:var(--ol-fg) !important;}';
    document.head.appendChild(s);
    // Do NOT postClean here — canonize runs on every load purely as an
    // in-editor aid (it's idempotent + guarded by data-ol-force), so persisting
    // it would fire an unsolicited save just from VIEWING a legacy/pasted
    // project. The canonized state is captured naturally on the first real edit.
  }
  canonizeAtRuntime();

  postPageMeta();
})();
`;

const INJECTION = `<style data-openlen-inspect>${INSPECT_STYLE}</style><script data-openlen-inspect>${INSPECT_SCRIPT}</script>`;

/** Returns the HTML with element-inspect instrumentation appended just
 *  before `</body>`. The injected style/script carry `data-openlen-inspect`
 *  so postClean (and the parent's stripEditorInstrumentation) can remove
 *  them — persisted HTML never carries the inspector. */
export function injectElementInspect(html: string): string {
  if (!html) return html;
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + INJECTION;
  return html.slice(0, idx) + INJECTION + html.slice(idx);
}

/** Source identifier for postMessage payloads + the version timeline. */
export const PROPS_SOURCE = "props" as const;
