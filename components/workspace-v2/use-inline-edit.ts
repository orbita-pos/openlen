// Inline-edit injection for flat (template-clone / paste) projects.
//
// Takes the project HTML and appends a <style> + <script> just before </body>.
// Inside the iframe, the script flips text-level elements to contentEditable,
// debounces input events, and posts the full document outerHTML back to the
// parent window via postMessage. The parent (app/new-v2/page.tsx) listens for
// `openlen:html-changed` and PATCHes /api/projects/<id>/html.
//
// Rich (slot-based) projects use the existing data-slot-path system in
// lib/blocks/_editable.tsx — they do NOT route through here.

const INLINE_EDIT_STYLE = `
[contenteditable]:hover {
  outline: 1px dashed rgba(255,90,54,0.4);
  outline-offset: 2px;
  cursor: text;
}
[contenteditable]:focus {
  outline: 1px solid rgba(255,90,54,0.8);
  outline-offset: 2px;
}
`;

// We walk every text node in document.body and mark its parent element as
// contenteditable. This catches text regardless of tag — <div>, <dt>, <td>,
// <figcaption>, custom elements, anything — instead of relying on a fixed
// list of semantic tags (which always misses something in arbitrary HTML).
//
// Skip rules:
//  - Non-content containers (script, style, head, iframe, canvas, etc.)
//  - SVG subtrees (text inside <text> elements isn't a useful edit target
//    here and contentEditable interacts oddly with SVG layout)
//  - Form inputs (input/textarea/select are editable on their own terms)
//  - Anything inside a `[data-openlen-no-edit]` opt-out marker
//  - Whitespace-only text nodes (formatting, not user-facing copy)
//
// Nesting: if an ancestor of the candidate parent is already editable, we
// don't mark the parent. The browser handles legitimate sibling nesting
// (e.g. <p> with text + <strong> with text → both marked, both clickable).
const INLINE_EDIT_SCRIPT = `
(function () {
  var SKIP_TAG = {SCRIPT:1,STYLE:1,NOSCRIPT:1,HEAD:1,HTML:1,META:1,LINK:1,TITLE:1,TEMPLATE:1,IFRAME:1,CANVAS:1,OBJECT:1,EMBED:1,VIDEO:1,AUDIO:1,INPUT:1,TEXTAREA:1,SELECT:1,OPTION:1,SVG:1};

  function enable() {
    try {
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var seen = new Set();
      var node;
      while ((node = walker.nextNode())) {
        if (!node.textContent || !node.textContent.trim()) continue;
        var p = node.parentElement;
        if (!p || seen.has(p)) continue;
        if (SKIP_TAG[p.tagName]) continue;
        if (p.closest('svg, script, style, noscript, template')) continue;
        if (p.closest('[data-openlen-no-edit]')) continue;
        var anc = p.parentElement;
        var skip = false;
        while (anc) {
          if (anc.getAttribute && anc.getAttribute('contenteditable') === 'plaintext-only') {
            skip = true;
            break;
          }
          anc = anc.parentElement;
        }
        if (skip) continue;
        p.setAttribute('contenteditable', 'plaintext-only');
        seen.add(p);
      }
    } catch (err) {
      /* TreeWalker not available — bail rather than try a half-baked fallback */
    }

    function captureClean() {
      // Clone so we don't mutate the live document. Strip the injection
      // markers (<style|<script data-openlen-inline-edit>) and the
      // contenteditable attributes we added — neither should be persisted
      // into project.data.html or end up on the published page.
      var clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll('[data-openlen-inline-edit]').forEach(function (n) { n.remove(); });
      clone.querySelectorAll('[contenteditable]').forEach(function (n) { n.removeAttribute('contenteditable'); });
      return '<!doctype html>\\n' + clone.outerHTML;
    }

    var timer = null;
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !(t instanceof Element) || !t.matches('[contenteditable]')) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        try {
          window.parent.postMessage(
            { type: 'openlen:html-changed', outerHtml: captureClean() },
            '*'
          );
        } catch (_) {}
      }, 400);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var active = document.activeElement;
      if (active && typeof active.blur === 'function') active.blur();
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enable);
  } else {
    enable();
  }
})();
`;

const INJECTION = `<style data-openlen-inline-edit>${INLINE_EDIT_STYLE}</style><script data-openlen-inline-edit>${INLINE_EDIT_SCRIPT}</script>`;

/** Returns an augmented HTML string with inline-edit instrumentation injected
 *  just before `</body>`. If the input has no `</body>`, the injection is
 *  appended to the end (works for body-less fragments too). Caller is
 *  responsible for only invoking this when the toggle is on AND the project
 *  is flat — rich projects use the slot-based editor instead. */
export function injectInlineEdit(html: string): string {
  if (!html) return html;
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + INJECTION;
  return html.slice(0, idx) + INJECTION + html.slice(idx);
}
