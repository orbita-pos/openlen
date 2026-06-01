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
// Placement is type-aware: a navbar lands at the top of the page, a footer at
// the bottom, everything else at the end (above a trailing footer if present).
// "Undo" posts `openlen:section-remove`; the script pulls the exact nodes it
// last inserted back out and re-serializes — no reload, so the preview never
// blanks to white.
//
// Parent → iframe:  { type: "openlen:section-insert", html: "<fragment>", sectionType }
// Parent → iframe:  { type: "openlen:section-remove" }
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

  function lastElement(parent) {
    var kids = candidates(parent);
    return kids.length ? kids[kids.length - 1] : null;
  }

  // Where a section of this type should land. Returns the node to insert
  // BEFORE, or null to append at the end. A navbar goes to the very TOP (a nav
  // dropped at the bottom was the "white band at the end" bug); a footer goes
  // to the bottom; everything else lands at the end but ABOVE a trailing footer
  // if the page already has one (so a CTA/features block doesn't fall below it).
  function placementAnchor(root, sectionType) {
    if (sectionType === 'navbar') return root.firstChild;
    if (sectionType === 'footer') return null;
    var last = lastElement(root);
    if (last && last.tagName === 'FOOTER') return last;
    return null;
  }

  // Navbars and footers are page singletons — replace an existing one instead
  // of stacking a second (two navbars is never what the user wants). Returns the
  // top-level landmark to swap out: the FIRST nav/header for a navbar, the LAST
  // footer for a footer. Heuristic — a non-semantic div-as-nav won't be caught.
  function findExistingSameType(root, sectionType) {
    var kids = candidates(root);
    if (sectionType === 'navbar') {
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].tagName === 'NAV' || kids[i].tagName === 'HEADER') return kids[i];
      }
      return null;
    }
    if (sectionType === 'footer') {
      for (var j = kids.length - 1; j >= 0; j--) {
        if (kids[j].tagName === 'FOOTER') return kids[j];
      }
      return null;
    }
    return null;
  }

  function insertFragment(fragHtml, sectionType) {
    var root = findContentRoot();
    if (!root) return null;

    // Singleton replace (navbar/footer): pull the existing one out FIRST (before
    // computing the anchor / inserting the new), remembering it + its slot so an
    // Undo can put it back exactly where it was.
    var removed = null;
    if (sectionType === 'navbar' || sectionType === 'footer') {
      var existing = findExistingSameType(root, sectionType);
      if (existing) {
        removed = { node: existing, sectionType: sectionType, parent: root };
        root.removeChild(existing);
      }
    }

    var tmp = document.createElement('div');
    tmp.innerHTML = fragHtml;
    var nodes = Array.prototype.slice.call(tmp.childNodes);
    var anchor = placementAnchor(root, sectionType);
    if (anchor && anchor.parentNode !== root) anchor = null; // safety
    var insertedEls = [];
    var insertedAll = [];
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
      // insertBefore(node, anchor) keeps order: each node lands just before the
      // anchor, after the previously inserted ones. null anchor → append.
      if (anchor) root.insertBefore(toAppend, anchor);
      else root.appendChild(toAppend);
      insertedAll.push(toAppend);
      if (toAppend.nodeType === 1) insertedEls.push(toAppend);
    });
    // Remember EVERY node we added (including the "\n" text nodes between the
    // font <link>/<style>/section parts) so an Undo pulls them ALL back out and
    // restores the DOM cleanly — element-only tracking left orphan whitespace in
    // the re-serialized HTML across add/undo cycles. No srcDoc reload: the live
    // DOM stays authoritative. removedReplace lets Undo also restore a swapped-out
    // navbar/footer.
    lastInsertedNodes = insertedAll.slice();
    removedReplace = removed;

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

  var lastInsertHtml = '';
  var lastInsertAt = 0;
  var lastInsertedNodes = [];
  var removedReplace = null;
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d) return;

    // Undo of the most recent insert — pull the exact nodes we added back out
    // and re-serialize through the SAME html-changed save path. No reload, so
    // the live DOM never blanks to white. If the insert replaced a singleton
    // (navbar/footer), put the old one back in its original slot.
    if (d.type === 'openlen:section-remove') {
      if (!lastInsertedNodes.length && !removedReplace) return;
      lastInsertedNodes.forEach(function (n) {
        if (n && n.parentNode) n.parentNode.removeChild(n);
      });
      lastInsertedNodes = [];
      if (removedReplace && removedReplace.node && removedReplace.parent) {
        // Restore the swapped-out singleton at its canonical spot (navbar→top,
        // footer→bottom) — robust even if the page was reordered between the
        // insert and this undo (a captured nextSibling anchor could have moved).
        var p = removedReplace.parent;
        if (removedReplace.sectionType === 'navbar') p.insertBefore(removedReplace.node, p.firstChild);
        else p.appendChild(removedReplace.node);
      }
      removedReplace = null;
      lastInsertHtml = '';
      setTimeout(postClean, 30);
      return;
    }

    if (d.type !== 'openlen:section-insert' || typeof d.html !== 'string') return;
    // Idempotency guard — appendChild is not idempotent, so a double-click (or a
    // stray duplicate message) posting the SAME fragment in quick succession
    // would stack two copies. Ignore an identical fragment within 1.2s. A
    // different section (different html) or an intentional repeat after the
    // window still inserts.
    var now = Date.now();
    if (d.html === lastInsertHtml && (now - lastInsertAt) < 1200) return;
    lastInsertHtml = d.html;
    lastInsertAt = now;
    var main = insertFragment(d.html, d.sectionType);
    if (!main) return;
    // Let layout settle (and any inserted <script> run) before serializing.
    setTimeout(postClean, 80);
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
