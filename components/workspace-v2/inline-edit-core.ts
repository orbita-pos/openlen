// Editor V5 — pure core logic for the in-iframe overlay text editor.
//
// WHY THIS FILE EXISTS
// The editor runtime runs INSIDE the preview iframe, injected as a serialized
// <script> string (see use-inline-edit.ts). A stringified IIFE can't be unit
// tested directly, so the decision-making logic lives here as ordinary
// exported functions that are BOTH:
//   (a) imported + unit-tested by Vitest (jsdom) — see inline-edit-core.test.ts
//   (b) serialized via Function.prototype.toString() into the iframe runtime
// There is no second copy to drift from: the tested function IS the injected
// function.
//
// HARD CONSTRAINT — every function exported here that gets stringified must be
// SELF-CONTAINED:
//   - reference only its own parameters, nested locals, and browser globals
//     (document, window, getComputedStyle, NodeFilter, Range…)
//   - NO imports, NO module-scope identifiers, NO calls to sibling exports
//     (inline a helper or pass it as a param instead)
//   - plain ES5 style (function declarations, var, no spread / optional
//     chaining / destructuring) so a bundler targeting old browsers can't lower
//     it into shared tslib helpers that wouldn't exist inside the iframe
// The composed script is syntax-checked by a `new Function(...)` unit test, and
// the self-contained rule is enforced by code review + that parse test.

/**
 * Computed-style properties mirrored from the original element onto the
 * overlay so glyphs land in the same place character-for-character. camelCase
 * so `overlay.style[prop] = computed[prop]` works directly. Injected into the
 * runtime as JSON (data, not a function).
 *
 * Categories (Phase 3.1): typography, layout/wrap, decoration/shadow,
 * rendering, box, plus the gradient-clipped-text quartet
 * (-webkit-text-fill-color + background-image + background-clip) so trendy
 * "gradient hero" text renders correctly in the overlay too.
 */
export const STYLE_PROPS: readonly string[] = [
  // Typography
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontStretch",
  "fontVariant",
  "fontVariantLigatures",
  "fontVariantCaps",
  "fontVariantNumeric",
  "fontFeatureSettings",
  "fontKerning",
  "fontOpticalSizing",
  "fontSizeAdjust",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "color",
  // Layout / wrapping
  "textAlign",
  "textAlignLast",
  "textIndent",
  "textTransform",
  "textWrap",
  "textWrapMode",
  "textWrapStyle",
  "whiteSpace",
  "whiteSpaceCollapse",
  "wordBreak",
  "overflowWrap",
  "lineBreak",
  "hangingPunctuation",
  "hyphens",
  "tabSize",
  "direction",
  "writingMode",
  "unicodeBidi",
  "textOrientation",
  "verticalAlign",
  // Decoration / shadow
  "textShadow",
  "textDecoration",
  "textDecorationLine",
  "textDecorationColor",
  "textDecorationStyle",
  "textDecorationThickness",
  "textUnderlineOffset",
  "textUnderlinePosition",
  "textEmphasis",
  // Rendering
  "textRendering",
  "webkitFontSmoothing",
  "MozOsxFontSmoothing",
  "webkitTextStrokeColor",
  "webkitTextStrokeWidth",
  "webkitTextFillColor",
  // Gradient-clipped text (background-clip: text) — include the framing props
  // (size/position/repeat/origin) so the gradient samples the same color at
  // each glyph as the original; image alone defaults to auto/0% framing.
  "backgroundImage",
  "backgroundClip",
  "webkitBackgroundClip",
  "backgroundSize",
  "backgroundPosition",
  "backgroundRepeat",
  "backgroundOrigin",
  // Box (so padded text wraps at the same width). NOTE: box-sizing is
  // deliberately NOT mirrored — the overlay chrome forces border-box and
  // positionOverlay sets width to the original's CONTENT width (subtracting the
  // source border), so mirroring the source box model would double-count.
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
] as const;

/** True when a string is empty or only whitespace (incl. NBSP / zero-width). */
export function isBlankText(s: string | null | undefined): boolean {
  if (!s) return true;
  //   nbsp, ​ zero-width space, ﻿ bom — treat as blank.
  return !/[^\s ​﻿]/.test(s);
}

/**
 * Decide the edit granularity for a clicked editable element.
 *   "element" — the element has no child ELEMENTS (pure text run). Edit the
 *               whole element; overlay matches its content box so
 *               text-wrap:balance / centering wrap identically.
 *   "run"     — the element contains inline marks (<strong>/<em>/<a>/<span>/
 *               <br>…). Edit only the clicked text node so sibling marks
 *               survive the round-trip.
 * Pure: depends only on the element's child-element count.
 */
export function chooseEditMode(editable: Element): "element" | "run" {
  return editable.children.length === 0 ? "element" : "run";
}

// NOTE: the two functions below INLINE their blank-text + first-text helpers
// rather than calling the isBlankText / firstNonBlankTextNode exports. That
// duplication is deliberate — see the self-containment constraint at the top:
// a stringified function must not reference another top-level export by name
// (a bundler could mangle the cross-reference). Self-recursion and nested
// inner functions are safe; cross-export calls are not.

/**
 * Walk to the text node that should be edited given the node a caret API
 * resolved to (which may be a text node, or an element when the click landed
 * between glyphs). Returns a non-blank text node within `editable`, or null.
 * Pure DOM — jsdom-testable. Self-contained (inlines blank + first-text).
 */
export function findRunTextNode(
  editable: Element,
  caretNode: Node | null,
): Text | null {
  function blank(s: string | null | undefined): boolean {
    return !s || !/[^\s ​﻿]/.test(s);
  }
  function firstText(root: Node): Text | null {
    var d =
      root.ownerDocument ||
      (typeof document !== "undefined" ? document : null);
    if (d && typeof d.createTreeWalker === "function") {
      var w = d.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var n = w.nextNode();
      while (n) {
        if (!blank((n as Text).data)) return n as Text;
        n = w.nextNode();
      }
      return null;
    }
    var kids = root.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType === 3 && !blank((k as Text).data)) return k as Text;
    }
    return null;
  }
  if (!caretNode) return null;
  // Caret landed directly on a text node — use it if it carries real text.
  if (caretNode.nodeType === 3 /* TEXT_NODE */) {
    var t = caretNode as Text;
    if (editable.contains(t) && !blank(t.data)) return t;
    return null;
  }
  // Caret landed on an element (between/around children) — take the first
  // non-blank text node within it that is still inside `editable`.
  if (caretNode.nodeType === 1 /* ELEMENT_NODE */) {
    var el = caretNode as Element;
    if (!editable.contains(el) && el !== editable) return null;
    return firstText(el);
  }
  return null;
}

/** First non-blank descendant text node of `root`, or null. Pure DOM.
 *  Self-contained (inlines its own blank-text check). */
export function firstNonBlankTextNode(root: Node): Text | null {
  function blank(s: string | null | undefined): boolean {
    return !s || !/[^\s ​﻿]/.test(s);
  }
  var doc =
    root.ownerDocument || (typeof document !== "undefined" ? document : null);
  if (!doc || typeof doc.createTreeWalker !== "function") {
    // Minimal fallback when TreeWalker is unavailable.
    var kids = (root as Element).childNodes;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType === 3 && !blank((k as Text).data)) return k as Text;
    }
    return null;
  }
  var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  var node = walker.nextNode();
  while (node) {
    if (!blank((node as Text).data)) return node as Text;
    node = walker.nextNode();
  }
  return null;
}

/**
 * Whether a computed style establishes a containing block for fixed-positioned
 * descendants (transform / filter / perspective / will-change / contain).
 * Used to choose `position: fixed` (viewport) vs `absolute` for the overlay.
 * Pure: takes a plain {transform, filter, perspective, willChange, contain}
 * object so it's trivially unit-testable.
 */
export function establishesContainingBlock(cs: {
  transform?: string;
  filter?: string;
  perspective?: string;
  willChange?: string;
  contain?: string;
}): boolean {
  if (!cs) return false;
  if (cs.transform && cs.transform !== "none") return true;
  if (cs.filter && cs.filter !== "none") return true;
  if (cs.perspective && cs.perspective !== "none") return true;
  if (cs.willChange && /transform|perspective|filter/.test(cs.willChange)) return true;
  if (cs.contain && /paint|layout|strict|content/.test(cs.contain)) return true;
  return false;
}

/**
 * Build the {prop: value} map to apply to the overlay from a computed-style
 * object. Skips empty / "none" padding noise that would override the chrome
 * CSS. Pure: `computed` is any object indexable by the prop names.
 */
export function buildStyleMirror(
  computed: Record<string, string> | CSSStyleDeclaration,
  props: readonly string[],
): Record<string, string> {
  var out: Record<string, string> = {};
  for (var i = 0; i < props.length; i++) {
    var p = props[i];
    var v: string | undefined;
    try {
      v = (computed as Record<string, string>)[p];
    } catch (_e) {
      v = undefined;
    }
    if (v === undefined || v === null || v === "") continue;
    out[p] = v;
  }
  return out;
}

/**
 * Serialize an element's text content with <br> rendered as "\n" (Phase 7.4).
 * Block/inline elements contribute their own textContent inline. Pure DOM.
 * For a "clean text element" (no child elements) this equals textContent.
 */
export function serializeTextWithBreaks(el: Element): string {
  var out = "";
  var kids = el.childNodes;
  for (var i = 0; i < kids.length; i++) {
    var n = kids[i];
    if (n.nodeType === 3 /* TEXT */) {
      out += (n as Text).data;
    } else if (n.nodeType === 1 /* ELEMENT */) {
      var e = n as Element;
      if (e.tagName === "BR") out += "\n";
      else out += serializeTextWithBreaks(e);
    }
  }
  return out;
}

/**
 * Convert plain text (possibly containing "\n" soft breaks the user typed via
 * Shift+Enter) into HTML-safe markup with <br> for newlines. Used to commit a
 * multi-line element-mode edit. Pure.
 */
export function linesToBreaksHtml(text: string): string {
  var esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc.replace(/\r\n|\r|\n/g, "<br>");
}

/**
 * Resolve a caret Range from a viewport point, trying the modern then legacy
 * API, constrained to land inside `withinNode`. Self-contained: `doc` is
 * passed in (the iframe's document) so it's mockable in tests.
 * Returns a collapsed Range, or null when neither API resolves inside the node.
 */
export function caretRangeFromPoint(
  doc: Document,
  x: number,
  y: number,
  withinNode: Node,
): Range | null {
  try {
    var anyDoc = doc as unknown as {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      createRange: () => Range;
    };
    if (typeof anyDoc.caretPositionFromPoint === "function") {
      var pos = anyDoc.caretPositionFromPoint(x, y);
      if (pos && withinNode.contains(pos.offsetNode)) {
        var r = anyDoc.createRange();
        r.setStart(pos.offsetNode, pos.offset);
        r.collapse(true);
        return r;
      }
    }
    if (typeof anyDoc.caretRangeFromPoint === "function") {
      var r2 = anyDoc.caretRangeFromPoint(x, y);
      if (r2 && withinNode.contains(r2.startContainer)) {
        r2.collapse(true);
        return r2;
      }
    }
  } catch (_e) {
    /* fall through to null */
  }
  return null;
}
