// ============================================================================
// Inline-edit injection — Editor V5 (persistent iframe + overlay editor).
// ============================================================================
//
// ARCHITECTURE
// ------------
// OpenLen pages are AI-generated HTML rendered in a sandboxed preview iframe.
// Editing must (a) never reload the iframe on a mode toggle, (b) never put
// `contenteditable` on the page DOM (Chromium disables `text-wrap: balance` on
// editable content — heroes would re-wrap mid-edit), and (c) render the text
// being edited PIXEL-IDENTICALLY to the published page.
//
// The mechanism: when the user clicks text in edit mode we hide the real text
// (visibility:hidden — keeps its layout space so balance/grid/flex don't
// shift) and float a `contenteditable=plaintext-only` overlay div on top,
// styled with the original's computed text styles so glyphs land in the same
// place. The user types into the overlay; on commit the text is written back
// to the page DOM and the overlay is removed. No page element is ever
// contenteditable, so balance keeps running everywhere, always.
//
// This file is the CENTRAL BOOTSTRAP for ALL five editor scripts: it is the
// only one that installs the `openlen:set-mode` receiver and posts
// `openlen:iframe-ready`. The other scripts (inspect / section-select /
// reorder / replace / insert) only READ the body mode attributes this script
// sets. Do not move setupModeReceiver / the iframe-ready post out of here.
//
// V4 → V5 — the seven gaps V4 left open, now closed:
//   1. Positioning broke when an ancestor (or <html>/<body>) had a transform /
//      filter / perspective — `position: fixed` was then relative to that box,
//      not the viewport. V5: choose fixed-vs-absolute from a containing-block
//      probe AND self-correct by measuring the overlay's real rect and nudging
//      by the residual delta (bulletproof for transformed <html>/<body>).
//   2. No inline-formatting preservation — `<strong>/<em>/<a>/<span>` were
//      flattened via textContent. V5: run-level editing. If the element has
//      child elements we edit ONLY the clicked text node (the rest of the
//      marks are untouched); a clean text element is edited whole.
//   3. No multi-line / <br>. V5: Shift+Enter inserts a soft break; element-mode
//      commits convert "\n" → <br> (HTML-escaped). <br>-laden elements are
//      "rich" → run-mode, so existing <br>s are preserved untouched.
//   4. No reflow tracking. V5: ResizeObserver on the target + a RAF reposition
//      loop while editing → the overlay stays glued through lazy-image loads,
//      web-font swaps, and animations.
//   5. Caret could miss. V5: caretPositionFromPoint → caretRangeFromPoint →
//      caret-at-end fallback chain, constrained to the overlay.
//   6. iframe zoom. NON-ISSUE by construction: the overlay lives INSIDE the
//      iframe, so it shares the iframe's coordinate space; the parent's
//      `transform: scale()` maps clicks to iframe-local coords before dispatch.
//      getBoundingClientRect + caret APIs are all iframe-local → correct at any
//      zoom with no extra math.
//   7. Edge cases (empty element, RTL, fast double-click, click-in-overlay,
//      img/svg-only) — see PHASE 7 handling below.
//
// V5 HARDENING (feature/editor-v5-hardening) — measured against a 290-body real
// corpus (188 curated templates + 102 sections; 45,220 editable elements). The
// V4→V5 gaps above are joined by four corpus-driven fixes:
//   A. Forced-pre-wrap whitespace: a contenteditable=plaintext-only host is
//      forced to white-space:pre-wrap by Chromium (author CSS can't override),
//      so a source text node's pretty-printed newlines/indent rendered literally
//      → spurious wrap + one-line-low. The overlay text is now COLLAPSED to the
//      page's rendered form (collapseWhitespaceForOverlay), preserving only
//      significant inter-run spaces. (Was the single biggest corpus failure.)
//   B. Glyph-anchored self-correct: the overlay's FIRST GLYPH is aligned to the
//      original's first glyph (re-measured live; the hidden original stays laid
//      out). Fixes the half-leading gap between an inline run's glyph-rect top
//      and a block line box, plus any containing-block origin shift — exactly,
//      regardless of font size.
//   C. Run box: a run's posTarget rect is content-level, so the overlay carries
//      NO padding/border adjustment (was inheriting the parent's), and a
//      single-line run is WIDENED so the forced pre-wrap can't re-wrap it.
//   D. Multi-line inline target (run or display:inline element) is laid out in
//      its BLOCK CONTAINER's content box with text-indent = first-fragment
//      offset, so soft-wrap columns + per-line lefts match the page.
// Result: 100% on all standard 2D patterns (centered/left/right, balance, vw
// clamp fonts, gradient-clipped text, transformed-via-translate ancestors,
// multi-line, padded runs, editorial text-indent).
//
// ARCHITECTURAL BOUNDARY (NOT a flagged-and-forgotten limitation — these need a
// different mechanism; see the Phase-6 spec in the hardening handoff):
//   - Editable text inside a 3D-transformed ancestor (matrix3d: rotateY flips /
//     perspective tilts) or an actively-ANIMATING ancestor (marquee / scroll /
//     float keyframes). A body-level 2D overlay cannot reproduce a 3D projection
//     or a moving target's instantaneous layout without composing the matrix3d
//     and frame-locking. (~0.19% of corpus elements; decorative regions.)
//   - A CENTERED/justified run whose wrapped lines SHARE a visual line with
//     sibling inline content: the run's per-line centering depends on the
//     siblings' widths, which an isolated run overlay lacks. Left/start runs
//     (deterministic via text-indent) and standalone centered runs are exact.
//
// The decision logic (style mirror, run resolution, caret fallback,
// containing-block probe, <br> serialization) lives in ./inline-edit-core.ts
// as importable + unit-tested functions; here they're serialized into the
// injected runtime via Function.prototype.toString() (names chosen below, so a
// bundler mangling internal references can't break the injection). There is no
// second copy: the tested function IS the injected function.
//
// Parent contract:
//   IN  { type: "openlen:set-mode", editMode: boolean, selectMode: boolean }
//   OUT { type: "openlen:iframe-ready" }      (parent responds with set-mode)
//   OUT { type: "openlen:html-changed", outerHtml, source: "inline-edit" }

import {
  STYLE_PROPS,
  isBlankText,
  chooseEditMode,
  findRunTextNode,
  firstNonBlankTextNode,
  establishesContainingBlock,
  buildStyleMirror,
  serializeTextWithBreaks,
  collapseWhitespaceForOverlay,
  linesToBreaksHtml,
  caretRangeFromPoint,
} from "./inline-edit-core";

const INLINE_EDIT_STYLE = `
/* Editable affordances — gated on body[data-openlen-edit-mode] so idle
   pages look exactly like the published page. */
body[data-openlen-edit-mode] [data-openlen-editable]:hover {
  outline: 1px dashed rgba(255,90,54,0.4);
  outline-offset: 2px;
  cursor: text;
}
/* Hidden-during-edit — visibility:hidden preserves layout space so the
   surrounding text-balance / flexbox / grid keep their measurements. Applies
   to the whole element (element-mode) OR a temporary wrapper around just the
   clicked run (run-mode) so sibling marks stay visible. */
[data-openlen-edit-hidden] {
  visibility: hidden !important;
}
/* The overlay editor — positioned + sized + styled inline by JS to match
   the hidden original exactly. CSS here only sets the chrome (outline,
   caret + selection color) since dimensions + text styles are dynamic. */
[data-openlen-edit-overlay] {
  outline: 1px solid rgba(255,90,54,0.95);
  outline-offset: 2px;
  background: transparent;
  margin: 0;
  border: 0;
  caret-color: rgba(255,90,54,0.95);
  overflow: visible;
  box-sizing: border-box;
}
[data-openlen-edit-overlay]:focus {
  outline: 1px solid rgba(255,90,54,0.95);
  outline-offset: 2px;
}
[data-openlen-edit-overlay]::selection {
  background: rgba(255,90,54,0.25);
  color: inherit;
}
/* Empty-element hint (PHASE 7.1) — a brief pulse when the user clicks an
   element that has no editable text. Self-removes via animationend. */
@keyframes openlen-edit-noedit {
  0%, 100% { outline-color: rgba(255,90,54,0); }
  35% { outline-color: rgba(255,90,54,0.7); }
}
[data-openlen-edit-noedit] {
  outline: 1px dashed rgba(255,90,54,0);
  outline-offset: 2px;
  animation: openlen-edit-noedit 0.5s ease-out 1;
}
`;

// Core decision logic, serialized for the iframe. The var names below are what
// the glue references — chosen here, so a bundler renaming the source symbols
// can't desync the injection (Function.prototype.toString() returns each
// function's body verbatim and we bind it to OUR name).
const CORE_SRC = [
  `var STYLE_PROPS = ${JSON.stringify(STYLE_PROPS)};`,
  `var isBlankText = ${isBlankText.toString()};`,
  `var chooseEditMode = ${chooseEditMode.toString()};`,
  `var findRunTextNode = ${findRunTextNode.toString()};`,
  `var firstNonBlankTextNode = ${firstNonBlankTextNode.toString()};`,
  `var establishesContainingBlock = ${establishesContainingBlock.toString()};`,
  `var buildStyleMirror = ${buildStyleMirror.toString()};`,
  `var serializeTextWithBreaks = ${serializeTextWithBreaks.toString()};`,
  `var collapseWhitespaceForOverlay = ${collapseWhitespaceForOverlay.toString()};`,
  `var linesToBreaksHtml = ${linesToBreaksHtml.toString()};`,
  `var caretRangeFromPoint = ${caretRangeFromPoint.toString()};`,
].join("\n");

// The runtime glue. Hand-written browser JS — deliberately contains NO regex
// and NO `${` so it needs no double-escaping inside this template literal; all
// regex-bearing logic lives in CORE_SRC (injected via .toString()).
const INLINE_EDIT_SCRIPT = `
(function () {
${CORE_SRC}

  var SKIP_TAG = {SCRIPT:1,STYLE:1,NOSCRIPT:1,HEAD:1,HTML:1,META:1,LINK:1,TITLE:1,TEMPLATE:1,IFRAME:1,CANVAS:1,OBJECT:1,EMBED:1,VIDEO:1,AUDIO:1,INPUT:1,TEXTAREA:1,SELECT:1,OPTION:1,SVG:1};

  // Walk text nodes and mark the deepest text-bearing parents editable.
  // Idempotent — runs on iframe load + on every edit-mode flip (chat redesigns
  // that swap body content re-light correctly).
  function markEditableElements() {
    if (!document.body) return;
    try {
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var seen = new Set();
      var node;
      while ((node = walker.nextNode())) {
        if (!node.textContent || !node.textContent.trim()) continue;
        var p = node.parentElement;
        if (!p || seen.has(p)) continue;
        if (p.hasAttribute && p.hasAttribute('data-openlen-editable')) { seen.add(p); continue; }
        if (SKIP_TAG[p.tagName]) continue;
        if (p.closest && p.closest('svg, script, style, noscript, template')) continue;
        if (p.closest && p.closest('[data-openlen-no-edit]')) continue;
        if (p.closest && p.closest('[data-openlen-edit-overlay]')) continue;
        var anc = p.parentElement;
        var skip = false;
        while (anc && anc !== document.body) {
          if (anc.hasAttribute && anc.hasAttribute('data-openlen-editable')) { skip = true; break; }
          anc = anc.parentElement;
        }
        if (skip) continue;
        p.setAttribute('data-openlen-editable', '');
        seen.add(p);
      }
    } catch (err) { /* TreeWalker unavailable — bail */ }
  }

  // Serialize the live document stripped of ALL inline-edit instrumentation —
  // overlay, temp run-wrappers (unwrapped, not deleted, so the text survives),
  // and editable/hidden markers. The parent strips the OTHER scripts' markers.
  function captureClean() {
    var clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('[data-openlen-inline-edit]').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('[data-openlen-edit-overlay]').forEach(function (n) { n.remove(); });
    // Unwrap temp run-wrappers: replace each with its children so the run text
    // is preserved exactly (a stale wrapper must never reach the saved HTML).
    clone.querySelectorAll('[data-openlen-edit-wrap]').forEach(function (n) {
      var parent = n.parentNode;
      if (!parent) { return; }
      while (n.firstChild) { parent.insertBefore(n.firstChild, n); }
      parent.removeChild(n);
    });
    clone.querySelectorAll('[data-openlen-editable]').forEach(function (n) { n.removeAttribute('data-openlen-editable'); });
    clone.querySelectorAll('[data-openlen-edit-hidden]').forEach(function (n) { n.removeAttribute('data-openlen-edit-hidden'); });
    return '<!doctype html>\\n' + clone.outerHTML;
  }

  // Post the cleaned document to the parent SYNCHRONOUSLY. inline-edit only
  // posts on commit (Enter / blur-out / mode-off / run-switch) — never per
  // keystroke — so there is nothing to debounce here, and the parent already
  // debounces the network PATCH. Critically, a synchronous post is what lets a
  // commit-on-exit reach the parent BEFORE its listener teardown + srcDoc
  // re-derive when the user toggles edit mode off (otherwise the edit is lost).
  function postChanged() {
    try {
      window.parent.postMessage(
        { type: 'openlen:html-changed', outerHtml: captureClean(), source: 'inline-edit' },
        '*'
      );
    } catch (_) {}
  }

  // ── Overlay editor state ────────────────────────────────────────────────
  var editable = null;        // the [data-openlen-editable] element being edited
  var overlay = null;         // the floating contenteditable div
  var mode = null;            // 'element' | 'run'
  var textNode = null;        // run-mode: the single text node being edited
  var wrap = null;            // run-mode: temp <span> hiding just that run
  var posTarget = null;       // element whose rect drives overlay placement
  var anchorNode = null;      // original text whose FIRST GLYPH the overlay aligns to
  var snapshot = '';          // text snapshot for change detection
  var overlayAbsolute = false;// position:absolute (vs fixed) for this session
  var borderAdjustX = 0;      // source's L+R border, subtracted from overlay width
  var lastRectKey = '';       // change-detection for the RAF reposition loop
  var rafId = null;
  var resizeObs = null;

  function rectKey(r) { return r.left + ',' + r.top + ',' + r.width + ',' + r.height; }

  // First line-box rect of a node's text content. Used to anchor the overlay's
  // first glyph to the ORIGINAL's first glyph (visibility:hidden keeps the
  // original laid out, so its geometry is still measurable). rs[0] is the first
  // line's origin even when it is a leading-space fragment.
  function firstGlyphRect(node) {
    if (!node) return null;
    try {
      var rg = document.createRange();
      rg.selectNodeContents(node);
      var rs = rg.getClientRects();
      if (rs && rs.length) return rs[0];
      return rg.getBoundingClientRect();
    } catch (_e) { return null; }
  }

  // Lightweight movement probe for the RAF/observer reposition loop.
  function probeRect() { return posTarget.getBoundingClientRect(); }

  // Nearest block-level ancestor — it establishes the inline formatting context
  // a run/inline element wraps within. Used to reproduce soft-wrap columns.
  function blockContainer(node) {
    var a = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    while (a && a !== document.body) {
      var d;
      try { d = window.getComputedStyle(a).display; } catch (_e) { d = ''; }
      if (d !== 'inline' && d !== 'inline-block' && d !== 'inline-flex' && d !== 'contents') return a;
      a = a.parentElement;
    }
    return document.body;
  }

  // Content-box {left, width} of an element (border + padding removed).
  function contentBox(el) {
    var r = el.getBoundingClientRect();
    var bl = 0, br2 = 0, pl = 0, pr = 0;
    try {
      var cs = window.getComputedStyle(el);
      bl = parseFloat(cs.borderLeftWidth) || 0; br2 = parseFloat(cs.borderRightWidth) || 0;
      pl = parseFloat(cs.paddingLeft) || 0; pr = parseFloat(cs.paddingRight) || 0;
    } catch (_e) { /* defaults */ }
    return { left: r.left + bl + pl, width: Math.max(0, r.width - bl - br2 - pl - pr) };
  }

  // Overlay placement geometry: {left, top, width, height, indent}.
  //   element block      → the element's own border box (mirrored padding
  //                        positions text; border subtracted from width).
  //   single-line run    → the run's glyph rect, WIDENED so the forced-pre-wrap
  //                        host can't re-wrap a box sized to the exact text width
  //                        (the run only fit one line because its inline parent
  //                        gave it slack); the extra width is invisible and
  //                        glyph-anchoring keeps the first glyph pinned.
  //   multi-line inline  → (run OR display:inline element, left/start aligned)
  //                        laid out in the BLOCK CONTAINER's content box so
  //                        soft-wrap columns match the page, with text-indent =
  //                        the first fragment's offset so line 1 starts at the
  //                        run's start and lines 2+ hit the container's left edge
  //                        — exactly how inline content reflows. (Centered
  //                        multi-line keeps box geometry; alignment carries it.)
  function placement() {
    var rc = posTarget.getClientRects ? posTarget.getClientRects() : null;
    var multi = !!(rc && rc.length > 1);
    var align = '';
    try { align = window.getComputedStyle(posTarget).textAlign; } catch (_e) { /* */ }
    var inlineFlow = align === 'left' || align === 'start' || align === '';
    var bound = posTarget.getBoundingClientRect();

    if (mode === 'run') {
      if (multi) {
        // Multi-line run: lay out in the block container so soft-wrap columns +
        // alignment match the page. text-indent offsets line 1 to the run start
        // for left/start flow; centered/right wrapping is carried by alignment
        // (indent 0), with glyph-anchoring pinning line 1.
        var cb = contentBox(blockContainer(posTarget));
        return { left: cb.left, top: rc[0].top, width: cb.width, height: bound.height,
                 indent: inlineFlow ? rc[0].left - cb.left : 0 };
      }
      var single = rc && rc.length ? rc[0] : bound;
      var fs = parseFloat(overlay.style.fontSize) || 16;
      return { left: single.left, top: single.top, width: single.width + Math.max(24, fs * 1.5),
               height: bound.height, indent: 0 };
    }

    // element-mode
    var disp = '';
    try { disp = window.getComputedStyle(posTarget).display; } catch (_e) { /* */ }
    if (multi && disp === 'inline') {
      var cb2 = contentBox(blockContainer(posTarget));
      return { left: cb2.left, top: rc[0].top, width: cb2.width, height: bound.height,
               indent: inlineFlow ? rc[0].left - cb2.left : 0 };
    }
    // Block element: keep the MIRRORED text-indent (editorial paragraphs use
    // text-indent for first-line indents) — indent:null means "don't override".
    return { left: bound.left, top: bound.top, width: Math.max(0, bound.width - borderAdjustX),
             height: bound.height, indent: null };
  }

  // Place the overlay over posTarget. Transform-safe: pick fixed vs absolute
  // from a containing-block probe, then SELF-CORRECT by measuring where the
  // overlay actually landed and nudging by the residual delta. The self-correct
  // makes the result pixel-exact even when <html>/<body> establishes a
  // containing block (transform/filter/perspective) that shifts the origin.
  function positionOverlay() {
    if (!overlay || !posTarget) return;
    var p = placement();
    if (overlayAbsolute) {
      var br = document.body.getBoundingClientRect();
      overlay.style.position = 'absolute';
      overlay.style.left = (p.left - br.left) + 'px';
      overlay.style.top = (p.top - br.top) + 'px';
    } else {
      overlay.style.position = 'fixed';
      overlay.style.left = p.left + 'px';
      overlay.style.top = p.top + 'px';
    }
    overlay.style.width = Math.max(0, p.width) + 'px';
    overlay.style.minHeight = p.height + 'px';
    // text-indent positions a multi-line inline target's FIRST line at the run's
    // start. null = leave the mirrored value (block elements keep their own
    // first-line text-indent, e.g. editorial paragraphs).
    if (p.indent != null) overlay.style.textIndent = p.indent + 'px';
    var r = { left: p.left, top: p.top, width: p.width, height: p.height };

    // SELF-CORRECT. Prefer GLYPH anchoring: align the overlay's first rendered
    // glyph to the ORIGINAL's first glyph. This is exact regardless of (a) a
    // transformed <html>/<body> shifting the fixed/absolute origin, (b) the
    // half-leading gap between an inline run's glyph-rect top and a block line
    // box's top, and (c) sub-pixel box rounding — because it measures where the
    // text ACTUALLY landed, not where the box edge is. Falls back to box-edge
    // correction if glyph geometry is unavailable.
    var oa = firstGlyphRect(anchorNode);
    var va = firstGlyphRect(overlay);
    var gdx, gdy;
    if (oa && va && (oa.width > 0 || oa.height > 0) && (va.width > 0 || va.height > 0)) {
      gdx = oa.left - va.left;
      gdy = oa.top - va.top;
    } else {
      var a = overlay.getBoundingClientRect();
      gdx = r.left - a.left;
      gdy = r.top - a.top;
    }
    if (gdx < -0.5 || gdx > 0.5 || gdy < -0.5 || gdy > 0.5) {
      var curLeft = parseFloat(overlay.style.left) || 0;
      var curTop = parseFloat(overlay.style.top) || 0;
      overlay.style.left = (curLeft + gdx) + 'px';
      overlay.style.top = (curTop + gdy) + 'px';
    }
    lastRectKey = rectKey(probeRect());
  }

  // RAF backstop while editing — reposition only when the target's rect moved.
  // Catches anything ResizeObserver/scroll/resize miss (animations, reflow from
  // async font swaps, ancestor transitions). Gated strictly by edit state.
  function syncLoop() {
    if (!overlay || !posTarget) { rafId = null; return; }
    if (rectKey(probeRect()) !== lastRectKey) positionOverlay();
    rafId = window.requestAnimationFrame(syncLoop);
  }

  function startSync() {
    stopSync();
    try {
      if (typeof ResizeObserver !== 'undefined') {
        resizeObs = new ResizeObserver(function () { positionOverlay(); });
        if (posTarget) resizeObs.observe(posTarget);
        if (document.body) resizeObs.observe(document.body);
      }
    } catch (_) {}
    if (rafId == null) rafId = window.requestAnimationFrame(syncLoop);
  }

  function stopSync() {
    if (resizeObs) { try { resizeObs.disconnect(); } catch (_) {} resizeObs = null; }
    if (rafId != null) { try { window.cancelAnimationFrame(rafId); } catch (_) {} rafId = null; }
  }

  // Wrap a single text node in a temporary hidden <span> so only the clicked
  // run is hidden while sibling marks stay visible (run-mode). visibility:hidden
  // keeps the run's inline box so the overlay sits exactly over it.
  function wrapRun(tn) {
    var span = document.createElement('span');
    span.setAttribute('data-openlen-edit-wrap', '');
    span.setAttribute('data-openlen-edit-hidden', '');
    var parent = tn.parentNode;
    if (!parent) return null;
    parent.insertBefore(span, tn);
    span.appendChild(tn);
    return span;
  }

  function unwrapRun() {
    if (!wrap) return;
    var parent = wrap.parentNode;
    if (parent) {
      while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
      parent.removeChild(wrap);
    }
    wrap = null;
  }

  function startEdit(el, clickX, clickY) {
    if (!el) return;
    // Always finish (commit) any in-flight edit first — covers fast
    // double-clicks on different elements + run-to-run switching (PHASE 7.6).
    finishEdit(true);

    // Empty-element guard (PHASE 7.1) — nothing to edit; flash a hint, bail.
    if (isBlankText(serializeTextWithBreaks(el))) {
      try {
        el.setAttribute('data-openlen-edit-noedit', '');
        var clear = function () {
          el.removeAttribute('data-openlen-edit-noedit');
          el.removeEventListener('animationend', clear);
        };
        el.addEventListener('animationend', clear);
        setTimeout(clear, 700);
      } catch (_) {}
      return;
    }

    editable = el;
    mode = chooseEditMode(el);

    var styleSource;
    var rawInitial;        // text before whitespace-collapse (mode-specific)
    var hasPrevSib = false;// run-mode: a sibling abuts the run's leading edge
    var hasNextSib = false;// run-mode: a sibling abuts the run's trailing edge
    if (mode === 'run') {
      var range = caretRangeFromPoint(document, clickX, clickY, el);
      var caretNode = range ? range.startContainer : null;
      var tn = findRunTextNode(el, caretNode);
      if (!tn) tn = firstNonBlankTextNode(el);
      if (!tn) { mode = 'element'; } else {
        // Capture sibling adjacency BEFORE wrapping (wrapRun re-parents tn).
        hasPrevSib = !!tn.previousSibling;
        hasNextSib = !!tn.nextSibling;
        wrap = wrapRun(tn);
        if (!wrap) {
          // Couldn't wrap (detached text node) — fall back to element-mode
          // rather than leave the run un-hidden behind the overlay.
          mode = 'element';
        } else {
          textNode = tn;
          anchorNode = tn;
          styleSource = tn.parentElement || el;
          rawInitial = tn.data;
          posTarget = wrap;
        }
      }
    }
    if (mode === 'element') {
      styleSource = el;
      anchorNode = el;
      rawInitial = serializeTextWithBreaks(el);
      el.setAttribute('data-openlen-edit-hidden', '');
      posTarget = el;
    }

    var cs = window.getComputedStyle(styleSource);
    // Collapse the raw source text to what the page RENDERS — the overlay host
    // is forced to white-space:pre-wrap (Chromium), so feeding it the raw text
    // node (with pretty-print newlines/indentation) would render those literally.
    var initialText = collapseWhitespaceForOverlay(
      rawInitial, cs.whiteSpace, hasPrevSib, hasNextSib,
    );
    snapshot = initialText;

    // Element-mode mirrors the element's own box (padding positions text, border
    // is subtracted from width). Run-mode's posTarget rect is the run's GLYPH
    // rect — already content-level — so the overlay must carry NO padding/border
    // adjustment, else the content box shrinks and the run wraps spuriously.
    borderAdjustX =
      mode === 'element'
        ? (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0)
        : 0;
    overlay = document.createElement('div');
    overlay.setAttribute('data-openlen-edit-overlay', '');
    overlay.setAttribute('contenteditable', 'plaintext-only');
    overlay.setAttribute('spellcheck', 'true');
    overlay.textContent = initialText;
    overlay.style.zIndex = '2147483647';
    overlay.style.pointerEvents = 'auto';
    overlay.style.transformOrigin = '0 0';
    var styles = buildStyleMirror(cs, STYLE_PROPS);
    for (var k in styles) {
      if (!Object.prototype.hasOwnProperty.call(styles, k)) continue;
      try { overlay.style[k] = styles[k]; } catch (_) {}
    }
    if (mode === 'run') {
      // styleSource is the run's PARENT; its padding belongs to the box, not the
      // run. Zero it so the overlay's content box equals the run's glyph rect.
      overlay.style.paddingTop = '0';
      overlay.style.paddingRight = '0';
      overlay.style.paddingBottom = '0';
      overlay.style.paddingLeft = '0';
    }
    // NB: white-space is the MIRRORED value (not forced to pre-wrap). Under the
    // source's real white-space (usually 'normal') the overlay collapses
    // leading/interior whitespace exactly like the page does — so pretty-
    // printed source whitespace in a run's text node doesn't render literally
    // and shift the text on edit.

    overlayAbsolute = false;
    try {
      overlayAbsolute =
        establishesContainingBlock(window.getComputedStyle(document.body)) ||
        establishesContainingBlock(window.getComputedStyle(document.documentElement));
    } catch (_) {}

    document.body.appendChild(overlay);
    positionOverlay();
    startSync();

    // Focus + caret at the click point. The overlay is now top-most (max
    // z-index) so the caret API resolves into it (PHASE 5).
    try { overlay.focus({ preventScroll: true }); } catch (_) { try { overlay.focus(); } catch (__) {} }
    var caretRange = caretRangeFromPoint(document, clickX, clickY, overlay);
    if (!caretRange) {
      caretRange = document.createRange();
      caretRange.selectNodeContents(overlay);
      caretRange.collapse(false);
    }
    var sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(caretRange); }
  }

  // commit=true: write the overlay text back (Enter, blur-outside, mode-off).
  // commit=false: discard (Escape). Either way, fully tear down the session.
  function finishEdit(commit) {
    if (commit === undefined) commit = true;
    if (!editable || !overlay) return;
    stopSync();

    var el = editable;
    var ov = overlay;
    var m = mode;
    var tn = textNode;
    var newText = ov.textContent;
    var changed = false;

    if (commit && newText !== snapshot) {
      if (m === 'run' && tn) {
        tn.data = newText;             // surgical — sibling marks untouched
      } else {
        // element-mode: a soft break (Shift+Enter) becomes <br> on commit.
        if (newText.indexOf(String.fromCharCode(10)) !== -1) {
          el.innerHTML = linesToBreaksHtml(newText);
        } else {
          el.textContent = newText;
        }
      }
      changed = true;
    }

    // Tear down — order matters: remove overlay, restore the page text.
    try { ov.remove(); } catch (_) {}
    if (m === 'run') {
      unwrapRun();
    } else {
      el.removeAttribute('data-openlen-edit-hidden');
    }

    editable = null; overlay = null; mode = null; textNode = null;
    posTarget = null; anchorNode = null; snapshot = ''; lastRectKey = ''; borderAdjustX = 0;

    if (changed) postChanged();
  }

  function isEditMode() {
    return !!(document.body && document.body.hasAttribute('data-openlen-edit-mode'));
  }

  // Capture-phase click — element-inspect also runs in capture; stopPropagation
  // in its listener doesn't block ours (same node, different listener). Both
  // fire: inspect selects for the Properties panel, inline-edit opens the
  // overlay. Orthogonal surfaces by design.
  document.addEventListener('click', function (e) {
    if (!isEditMode()) return;
    // Click inside the active overlay → no-op, don't restart (PHASE 7.7).
    if (e.target && e.target.closest && e.target.closest('[data-openlen-edit-overlay]')) return;
    var t = e.target;
    while (t && t !== document.body) {
      if (t.hasAttribute && t.hasAttribute('data-openlen-editable')) break;
      t = t.parentElement;
    }
    if (!t || t === document.body) return;
    startEdit(t, e.clientX, e.clientY);
  }, true);

  // Keep the overlay glued to a growing multi-line edit.
  document.addEventListener('input', function (e) {
    if (e.target !== overlay) return;
    positionOverlay();
  });

  document.addEventListener('keydown', function (e) {
    if (!overlay) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      finishEdit(false);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      finishEdit(true);
    } else if (e.key === 'Enter' && e.shiftKey && mode === 'run') {
      // Run-mode edits ONE inline text node — a soft break there can't be
      // persisted (a newline in a single text node collapses at render). Block
      // it so the overlay never shows a break the commit would silently drop.
      // Element-mode keeps Shift+Enter → native soft break → <br> on commit.
      e.preventDefault();
    }
  });

  // Blur outside the overlay commits (PHASE 6.2 — Notion/Figma pattern: focus
  // moving away saves, it never silently cancels). focusout fires before focus
  // settles, so defer one tick and re-check activeElement.
  document.addEventListener('focusout', function (e) {
    if (e.target !== overlay) return;
    setTimeout(function () {
      if (overlay && document.activeElement !== overlay) finishEdit(true);
    }, 0);
  });

  // Keep the overlay glued as the page scrolls or resizes.
  window.addEventListener('scroll', function () { positionOverlay(); }, true);
  window.addEventListener('resize', function () { positionOverlay(); });

  function onModeChange() {
    if (isEditMode()) {
      markEditableElements();
    } else {
      // Leaving edit mode mid-edit — commit so work isn't silently lost.
      finishEdit(true);
    }
  }

  // Central bootstrap — the ONLY set-mode receiver across all editor scripts.
  // Maps parent mode flags onto body attributes the other scripts gate on,
  // then announces readiness so the parent pushes the current mode state.
  function setupModeReceiver() {
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || typeof d !== 'object' || d.type !== 'openlen:set-mode' || !document.body) return;
      if ('editMode' in d) {
        if (d.editMode) document.body.setAttribute('data-openlen-edit-mode', '');
        else document.body.removeAttribute('data-openlen-edit-mode');
      }
      if ('selectMode' in d) {
        if (d.selectMode) document.body.setAttribute('data-openlen-select-mode', '');
        else document.body.removeAttribute('data-openlen-select-mode');
      }
    });
    try { window.parent.postMessage({ type: 'openlen:iframe-ready' }, '*'); } catch (_) {}
  }

  function init() {
    if (!document.body) return;
    markEditableElements();
    onModeChange();
    setupModeReceiver();
    try {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          if (muts[i].type === 'attributes' && muts[i].attributeName === 'data-openlen-edit-mode') {
            onModeChange();
            return;
          }
        }
      }).observe(document.body, { attributes: true, attributeFilter: ['data-openlen-edit-mode'] });
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;

const INJECTION = `<style data-openlen-inline-edit>${INLINE_EDIT_STYLE}</style><script data-openlen-inline-edit>${INLINE_EDIT_SCRIPT}</script>`;

/** Returns an augmented HTML string with inline-edit instrumentation injected
 *  just before `</body>`. The script is ALWAYS injected (regardless of edit
 *  mode); it self-gates on body[data-openlen-edit-mode] and edits via a
 *  floating overlay so the page DOM never carries contenteditable — text-wrap:
 *  balance and other CSS layout effects stay honored at all times. */
export function injectInlineEdit(html: string): string {
  if (!html) return html;
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + INJECTION;
  return html.slice(0, idx) + INJECTION + html.slice(idx);
}

/** The composed iframe runtime — exported for the unit test that asserts it
 *  parses (catches any .toString() composition / self-containment breakage). */
export const __INLINE_EDIT_SCRIPT_FOR_TEST = INLINE_EDIT_SCRIPT;
