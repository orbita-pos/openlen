// Section-insert injection for the iframe — listens for an
// `openlen:section-insert` message from the parent, drops the (already
// host-safe, scoped) fragment into the page's content root, and posts the
// clean HTML back via the SAME `openlen:html-changed` contract that
// inline-edit / reorder use. The user then nudges it into place with the
// existing reorder drag (placement = sensible default + drag, no AI engine).
//
// Mirrors the reorder/inline-edit injection pattern: a <script> appended
// before </body>, gated implicitly by the fact the parent only sends the
// message in editing mode. The injected script carries an
// `data-openlen-section-insert` marker so it strips itself from the posted
// HTML; the parent's stripEditorInstrumentation handles the other tools.
//
// Parent → iframe:  { type: "openlen:section-insert", html: "<fragment>" }
// Iframe → parent:  { type: "openlen:html-changed", outerHtml, source: "section-insert" }

const INSERT_SCRIPT = `
(function () {
  var INERT = {SCRIPT:1, STYLE:1, LINK:1, META:1, NOSCRIPT:1, TEMPLATE:1, TITLE:1};
  var ROOT_TAGS = {SECTION:1, HEADER:1, FOOTER:1, NAV:1, MAIN:1, ARTICLE:1, ASIDE:1};

  // Match the reorder script's content-root logic so an inserted block lands
  // as a sibling of the existing top-level sections (and is then draggable).
  function candidates(parent) {
    var out = [];
    if (!parent || !parent.children) return out;
    for (var i = 0; i < parent.children.length; i++) {
      var el = parent.children[i];
      if (!el.tagName || INERT[el.tagName]) continue;
      out.push(el);
    }
    return out;
  }
  function findContentRoot() {
    var body = document.body;
    if (!body) return body;
    var top = candidates(body);
    if (top.length === 1) {
      var deeper = candidates(top[0]);
      if (deeper.length >= 2) return top[0];
    }
    return body;
  }

  function insertFragment(fragHtml) {
    var root = findContentRoot();
    if (!root) return null;
    var tmp = document.createElement('div');
    tmp.innerHTML = fragHtml;
    var nodes = Array.prototype.slice.call(tmp.childNodes);
    var insertedEls = [];
    nodes.forEach(function (node) {
      var toAppend = node;
      // <script> set via innerHTML never executes — recreate it so JS-driven
      // sections (comparison, tab-switchers) render in the live preview too.
      if (node.nodeType === 1 && node.tagName === 'SCRIPT') {
        var s = document.createElement('script');
        for (var i = 0; i < node.attributes.length; i++) {
          s.setAttribute(node.attributes[i].name, node.attributes[i].value);
        }
        s.textContent = node.textContent;
        toAppend = s;
      }
      root.appendChild(toAppend);
      if (toAppend.nodeType === 1) insertedEls.push(toAppend);
    });

    // The section element (for scroll + highlight): prefer a landmark/root tag.
    var main = null;
    for (var j = 0; j < insertedEls.length; j++) {
      if (ROOT_TAGS[insertedEls[j].tagName]) { main = insertedEls[j]; break; }
    }
    if (!main) {
      for (var k = insertedEls.length - 1; k >= 0; k--) {
        if (!INERT[insertedEls[k].tagName]) { main = insertedEls[k]; break; }
      }
    }
    if (main) {
      try { main.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
      main.setAttribute('data-openlen-just-inserted', '');
      main.style.outline = '2px solid rgba(255,90,54,0.65)';
      main.style.outlineOffset = '3px';
      setTimeout(function () {
        if (!main.isConnected) return;
        main.style.outline = '';
        main.style.outlineOffset = '';
        main.removeAttribute('data-openlen-just-inserted');
      }, 1500);
    }
    return main;
  }

  function postClean() {
    var clone = document.documentElement.cloneNode(true);
    // Strip this tool's own injected node + the transient highlight so the
    // saved HTML stays pristine (other tools are stripped parent-side).
    clone.querySelectorAll('[data-openlen-section-insert]').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('[data-openlen-just-inserted]').forEach(function (n) {
      n.removeAttribute('data-openlen-just-inserted');
      n.style.outline = '';
      n.style.outlineOffset = '';
    });
    try {
      window.parent.postMessage({
        type: 'openlen:html-changed',
        outerHtml: '<!doctype html>\\n' + clone.outerHTML,
        source: 'section-insert',
      }, '*');
    } catch (_) {}
  }

  // Build the :nth-of-type CSS breadcrumb the ai-design scope resolver wants
  // (resolveOpIdByPath uses :nth-of-type paths, NOT attribute selectors). Used
  // by "Match to page" to scope a re-theme to the just-inserted section — we
  // recompute the path on demand so it survives a reorder before matching.
  function olBuildPath(el) {
    var segs = [];
    var node = el;
    while (node && node.nodeType === 1 && node.tagName !== 'BODY' && node.tagName !== 'HTML') {
      var parent = node.parentElement;
      if (!parent) { segs.unshift(node.tagName.toLowerCase()); break; }
      var n = 0, found = 0;
      for (var i = 0; i < parent.children.length; i++) {
        var c = parent.children[i];
        if (c.tagName === node.tagName) { n++; if (c === node) found = n; }
      }
      segs.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + (found || 1) + ')');
      node = parent;
    }
    return segs.join(' > ');
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 'openlen:section-insert' || typeof d.html !== 'string') return;
    var main = insertFragment(d.html);
    if (!main) return;
    // Let layout settle (and any inserted <script> run) before serializing.
    setTimeout(postClean, 80);
  });

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 'openlen:section-path' || typeof d.secId !== 'string') return;
    var el = document.querySelector('[data-sec="' + d.secId + '"]');
    var path = el ? olBuildPath(el) : '';
    try {
      window.parent.postMessage(
        { type: 'openlen:section-path-result', secId: d.secId, path: path },
        '*',
      );
    } catch (_) {}
  });
})();
`;

const INJECTION = `<script data-openlen-section-insert>${INSERT_SCRIPT}</script>`;

/** Append section-insert instrumentation just before `</body>`. Always
 *  injected into the editing iframe (Editor V3 persistent-iframe pattern);
 *  it's inert until the parent posts an `openlen:section-insert` message. */
export function injectSectionInsert(html: string): string {
  if (!html) return html;
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + INJECTION;
  return html.slice(0, idx) + INJECTION + html.slice(idx);
}
