// Section-select injection for the iframe — hover outline + click capture
// that posts the selected element's metadata back to the workspace parent.
//
// Mirrors `use-inline-edit.ts` in structure but is read-only: the iframe DOM
// is never mutated permanently. Hovers add a `data-openlen-select-hover`
// attribute that's stripped before the click message fires.
//
// Parent contract (postMessage):
//   { type: "openlen:section-selected", hint, tag, path }
//   { type: "openlen:section-select-cancelled" }  // ESC
//
// `hint` is a human-readable label for the chat chip ("h1 — 'Catch your AI…'")
// derived from tag + innerText / id / classes. `path` is a CSS-selector
// breadcrumb (`section:nth-of-type(3) > div:nth-of-type(2) > h1:nth-of-type(1)`)
// the server uses to resolve the exact data-op-id of the clicked element, so
// the model gets a hard pin instead of a fuzzy text hint.

const SECTION_SELECT_STYLE = `
[data-openlen-select-hover] {
  outline: 2px solid rgba(255,90,54,0.65) !important;
  outline-offset: -2px !important;
  cursor: crosshair !important;
}
body[data-openlen-select-mode] {
  cursor: crosshair !important;
}
body[data-openlen-select-mode] * {
  cursor: crosshair !important;
}
body[data-openlen-select-mode] a {
  pointer-events: auto !important;
}
`;

const SECTION_SELECT_SCRIPT = `
(function () {
  var SKIP_TAG = {HTML:1,HEAD:1,BODY:1,SCRIPT:1,STYLE:1,LINK:1,META:1,TITLE:1,NOSCRIPT:1,TEMPLATE:1};
  var hovered = null;

  function isSelectable(el) {
    if (!el || !el.tagName) return false;
    if (SKIP_TAG[el.tagName]) return false;
    if (el.closest && el.closest('svg, script, style, noscript, template')) return false;
    return true;
  }

  function setHover(el) {
    if (hovered && hovered !== el) hovered.removeAttribute('data-openlen-select-hover');
    hovered = el;
    if (hovered) hovered.setAttribute('data-openlen-select-hover', '');
  }

  function cleanup() {
    if (hovered) hovered.removeAttribute('data-openlen-select-hover');
    hovered = null;
    document.body.removeAttribute('data-openlen-select-mode');
  }

  function buildHint(el) {
    var tag = el.tagName.toLowerCase();
    var text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text.length > 60) text = text.slice(0, 60) + '…';
    if (text) return tag + ' — "' + text + '"';
    if (el.id) return tag + '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      var cls = el.className.split(/\\s+/).filter(function (c) {
        return c && c.length > 0;
      }).slice(0, 2).join('.');
      if (cls) return tag + '.' + cls;
    }
    return tag;
  }

  // CSS selector breadcrumb from the clicked element up to body (exclusive).
  // Uses :nth-of-type because it's per-tag — our own injected <style>/<script>
  // at the end of <body> are different tag names so they don't shift counts.
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

  document.body.setAttribute('data-openlen-select-mode', '');

  document.addEventListener('mousemove', function (e) {
    var t = e.target;
    if (!isSelectable(t)) { setHover(null); return; }
    setHover(t);
  }, true);

  document.addEventListener('mouseleave', function () { setHover(null); }, true);

  document.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var t = e.target;
    if (!isSelectable(t)) return;
    cleanup();
    try {
      window.parent.postMessage({
        type: 'openlen:section-selected',
        hint: buildHint(t),
        tag: t.tagName.toLowerCase(),
        path: buildPath(t),
      }, '*');
    } catch (_) {}
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    cleanup();
    try {
      window.parent.postMessage({
        type: 'openlen:section-select-cancelled',
      }, '*');
    } catch (_) {}
  }, true);
})();
`;

const INJECTION = `<style data-openlen-section-select>${SECTION_SELECT_STYLE}</style><script data-openlen-section-select>${SECTION_SELECT_SCRIPT}</script>`;

/** Returns the HTML with the section-select instrumentation appended just
 *  before </body>. The injected style/script have `data-openlen-section-select`
 *  attributes so they can be stripped from any DOM-clone-based capture path
 *  (mirrors the inline-edit injection's discipline). */
export function injectSectionSelect(html: string): string {
  if (!html) return html;
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + INJECTION;
  return html.slice(0, idx) + INJECTION + html.slice(idx);
}
