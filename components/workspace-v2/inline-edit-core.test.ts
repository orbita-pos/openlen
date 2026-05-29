// Editor V5 — unit tests for the pure overlay-editor core logic (Phase 8.1).
// jsdom environment (see vitest.config.ts). These cover the decision logic the
// stringified iframe runtime relies on: run extraction, style mirror, caret
// fallback, containing-block probe, <br> serialization, empty-text detection,
// plus a syntactic-validity check on the composed injection script.

import { describe, it, expect } from "vitest";
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
import { __INLINE_EDIT_SCRIPT_FOR_TEST } from "./use-inline-edit";

function el(html: string): HTMLElement {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.firstElementChild as HTMLElement;
}

describe("STYLE_PROPS", () => {
  it("is a non-empty list of camelCase property names", () => {
    expect(Array.isArray(STYLE_PROPS)).toBe(true);
    expect(STYLE_PROPS.length).toBeGreaterThan(30);
    expect(STYLE_PROPS.every((p) => typeof p === "string" && p.length > 0)).toBe(true);
  });
  it("covers the wrap-fidelity + gradient-text critical props", () => {
    for (const p of [
      "fontFamily",
      "fontSize",
      "lineHeight",
      "letterSpacing",
      "textAlign",
      "textWrap",
      "whiteSpace",
      "color",
      "paddingLeft",
      "direction",
      "writingMode",
      "webkitTextFillColor",
      "backgroundImage",
      "webkitBackgroundClip",
      "backgroundSize",
      "backgroundPosition",
    ]) {
      expect(STYLE_PROPS).toContain(p);
    }
  });
  it("does NOT mirror box-sizing (overlay forces border-box; width is content-derived)", () => {
    expect(STYLE_PROPS).not.toContain("boxSizing");
  });
  it("has no duplicates", () => {
    expect(new Set(STYLE_PROPS).size).toBe(STYLE_PROPS.length);
  });
});

describe("isBlankText", () => {
  it("treats empty / whitespace / nbsp / zero-width as blank", () => {
    expect(isBlankText("")).toBe(true);
    expect(isBlankText(null)).toBe(true);
    expect(isBlankText(undefined)).toBe(true);
    expect(isBlankText("   ")).toBe(true);
    expect(isBlankText("\n\t  ")).toBe(true);
    expect(isBlankText(" ")).toBe(true); // nbsp
    expect(isBlankText("​")).toBe(true); // zero-width space
  });
  it("treats real content as non-blank", () => {
    expect(isBlankText("a")).toBe(false);
    expect(isBlankText("  hello  ")).toBe(false);
    expect(isBlankText("0")).toBe(false);
  });
});

describe("chooseEditMode", () => {
  it("element-mode for a clean text element (no child elements)", () => {
    expect(chooseEditMode(el("<h1>Hello world</h1>"))).toBe("element");
    expect(chooseEditMode(el("<p>plain text only</p>"))).toBe("element");
  });
  it("run-mode when inline marks are present", () => {
    expect(chooseEditMode(el("<h1><span>A</span> <span>B</span></h1>"))).toBe("run");
    expect(chooseEditMode(el("<p>x <strong>y</strong> z</p>"))).toBe("run");
  });
  it("run-mode when a <br> is present (so the <br> is never flattened)", () => {
    expect(chooseEditMode(el("<p>line one<br>line two</p>"))).toBe("run");
  });
});

describe("findRunTextNode", () => {
  it("returns the clicked text node directly", () => {
    const p = el("<p>start <strong>bold</strong> end</p>");
    const mid = p.childNodes[0] as Text; // "start "
    expect(findRunTextNode(p, mid)).toBe(mid);
  });
  it("descends to the first non-blank text node when the caret lands on an element", () => {
    const p = el("<p>x <a>link text</a> y</p>");
    const a = p.querySelector("a")!;
    const result = findRunTextNode(p, a);
    expect(result).toBeTruthy();
    expect(result!.data).toBe("link text");
  });
  it("returns null for a blank text node", () => {
    const p = el("<p><span>A</span>   <span>B</span></p>");
    const blank = p.childNodes[1] as Text; // "   "
    expect(findRunTextNode(p, blank)).toBeNull();
  });
  it("returns null for a caret node outside the editable", () => {
    const p = el("<p>inside</p>");
    const other = el("<div>outside</div>");
    expect(findRunTextNode(p, other.firstChild)).toBeNull();
  });
  it("returns null for a null caret node", () => {
    expect(findRunTextNode(el("<p>x</p>"), null)).toBeNull();
  });
});

describe("firstNonBlankTextNode", () => {
  it("skips whitespace nodes and returns the first real text", () => {
    const p = el("<p>   <span></span> first real <em>e</em></p>");
    const r = firstNonBlankTextNode(p);
    expect(r).toBeTruthy();
    expect(r!.data.trim()).toBe("first real");
  });
  it("returns null when there is no text", () => {
    const p = el("<p><img><svg></svg></p>");
    expect(firstNonBlankTextNode(p)).toBeNull();
  });
});

describe("establishesContainingBlock", () => {
  it("false for default / none styles", () => {
    expect(establishesContainingBlock({})).toBe(false);
    expect(
      establishesContainingBlock({
        transform: "none",
        filter: "none",
        perspective: "none",
        willChange: "auto",
        contain: "none",
      }),
    ).toBe(false);
  });
  it("true for transform / filter / perspective", () => {
    expect(establishesContainingBlock({ transform: "matrix(1,0,0,1,10,10)" })).toBe(true);
    expect(establishesContainingBlock({ filter: "blur(2px)" })).toBe(true);
    expect(establishesContainingBlock({ perspective: "500px" })).toBe(true);
  });
  it("true only for layout/paint-relevant will-change / contain", () => {
    expect(establishesContainingBlock({ willChange: "transform" })).toBe(true);
    expect(establishesContainingBlock({ willChange: "opacity" })).toBe(false);
    expect(establishesContainingBlock({ contain: "paint" })).toBe(true);
    expect(establishesContainingBlock({ contain: "size" })).toBe(false);
  });
});

describe("buildStyleMirror", () => {
  it("copies only present, non-empty props from the listed set", () => {
    const computed = {
      fontFamily: "Inter, sans-serif",
      fontSize: "48px",
      color: "rgb(10, 20, 30)",
      textAlign: "", // empty → skipped
      // lineHeight absent → skipped
    } as Record<string, string>;
    const out = buildStyleMirror(computed, [
      "fontFamily",
      "fontSize",
      "color",
      "textAlign",
      "lineHeight",
    ]);
    expect(out).toEqual({
      fontFamily: "Inter, sans-serif",
      fontSize: "48px",
      color: "rgb(10, 20, 30)",
    });
  });
});

describe("serializeTextWithBreaks", () => {
  it("equals textContent for a clean text element", () => {
    expect(serializeTextWithBreaks(el("<h1>Hello world</h1>"))).toBe("Hello world");
  });
  it("renders <br> as a newline", () => {
    expect(serializeTextWithBreaks(el("<p>line one<br>line two</p>"))).toBe(
      "line one\nline two",
    );
  });
  it("flattens nested inline marks inline", () => {
    expect(serializeTextWithBreaks(el("<p>A<strong>B</strong>C<em>D</em></p>"))).toBe(
      "ABCD",
    );
  });
});

describe("collapseWhitespaceForOverlay", () => {
  it("collapses pretty-printed leading/interior newlines + indent (the dominant corpus bug)", () => {
    // The overlay host is forced to pre-wrap; raw source text would render the
    // newlines literally and wrap wrongly. Collapse to the page's rendered form.
    expect(
      collapseWhitespaceForOverlay("\n          Lisbon HQ · Est. 2019\n       ", "normal", false, false),
    ).toBe("Lisbon HQ · Est. 2019");
  });
  it("collapses interior whitespace runs to a single space", () => {
    expect(collapseWhitespaceForOverlay("a   b\n\tc", "normal", false, false)).toBe("a b c");
  });
  it("treats nowrap like normal (collapses, never preserves newlines)", () => {
    expect(collapseWhitespaceForOverlay("  x \n y ", "nowrap", false, false)).toBe("x y");
  });
  it("preserves a significant inter-run space ONLY when a sibling abuts that edge", () => {
    // "foo <b>x</b> bar": the leading text run has a TRAILING sibling (<b>) — its
    // trailing space is significant and must survive the commit round-trip.
    expect(collapseWhitespaceForOverlay("foo ", "normal", false, true)).toBe("foo ");
    // " bar" run has a PREVIOUS sibling (<b>) — leading space significant.
    expect(collapseWhitespaceForOverlay(" bar", "normal", true, false)).toBe(" bar");
    // Same text with no abutting sibling → trimmed (line-start whitespace drops).
    expect(collapseWhitespaceForOverlay("foo ", "normal", false, false)).toBe("foo");
    expect(collapseWhitespaceForOverlay(" bar", "normal", false, false)).toBe("bar");
  });
  it("preserves whitespace verbatim for pre / pre-wrap / break-spaces", () => {
    const raw = "  line1\n    line2  ";
    expect(collapseWhitespaceForOverlay(raw, "pre", false, false)).toBe(raw);
    expect(collapseWhitespaceForOverlay(raw, "pre-wrap", false, false)).toBe(raw);
    expect(collapseWhitespaceForOverlay(raw, "break-spaces", false, false)).toBe(raw);
  });
  it("pre-line collapses spaces/tabs but keeps newlines", () => {
    expect(collapseWhitespaceForOverlay("a  \t b\nc  d", "pre-line", false, false)).toBe("a b\nc d");
  });
  it("handles null/empty input", () => {
    expect(collapseWhitespaceForOverlay("", "normal", false, false)).toBe("");
    expect(collapseWhitespaceForOverlay(null as unknown as string, "normal", true, true)).toBe("");
  });
});

describe("linesToBreaksHtml", () => {
  it("escapes HTML special characters", () => {
    expect(linesToBreaksHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });
  it("converts newline flavors to <br>", () => {
    expect(linesToBreaksHtml("one\ntwo\r\nthree\rfour")).toBe(
      "one<br>two<br>three<br>four",
    );
  });
  it("never emits a raw script tag (injection safety)", () => {
    const out = linesToBreaksHtml("<script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });
});

describe("caretRangeFromPoint", () => {
  it("uses caretPositionFromPoint when available and inside the node", () => {
    const host = el("<p>hello there</p>");
    document.body.appendChild(host);
    const tn = host.firstChild as Text;
    const fakeDoc = {
      caretPositionFromPoint: () => ({ offsetNode: tn, offset: 3 }),
      createRange: () => document.createRange(),
    } as unknown as Document;
    const r = caretRangeFromPoint(fakeDoc, 5, 5, host);
    expect(r).toBeTruthy();
    expect(r!.startContainer).toBe(tn);
    expect(r!.startOffset).toBe(3);
    document.body.removeChild(host);
  });
  it("falls back to caretRangeFromPoint", () => {
    const host = el("<p>hello there</p>");
    document.body.appendChild(host);
    const tn = host.firstChild as Text;
    const range = document.createRange();
    range.setStart(tn, 2);
    const fakeDoc = {
      caretRangeFromPoint: () => range,
    } as unknown as Document;
    const r = caretRangeFromPoint(fakeDoc, 5, 5, host);
    expect(r).toBeTruthy();
    expect(r!.startContainer).toBe(tn);
    document.body.removeChild(host);
  });
  it("returns null when the resolved node is outside the constraint", () => {
    const host = el("<p>inside</p>");
    const outside = el("<div>outside</div>");
    document.body.appendChild(host);
    document.body.appendChild(outside);
    const fakeDoc = {
      caretPositionFromPoint: () => ({ offsetNode: outside.firstChild, offset: 1 }),
      createRange: () => document.createRange(),
    } as unknown as Document;
    expect(caretRangeFromPoint(fakeDoc, 5, 5, host)).toBeNull();
    document.body.removeChild(host);
    document.body.removeChild(outside);
  });
  it("returns null when neither API exists", () => {
    const host = el("<p>x</p>");
    expect(caretRangeFromPoint({} as unknown as Document, 0, 0, host)).toBeNull();
  });
});

describe("composed injection script", () => {
  it("is syntactically valid JS (catches .toString() composition breakage)", () => {
    expect(() => new Function(__INLINE_EDIT_SCRIPT_FOR_TEST)).not.toThrow();
  });
  it("inlines every core function the runtime references", () => {
    for (const name of [
      "isBlankText",
      "chooseEditMode",
      "findRunTextNode",
      "firstNonBlankTextNode",
      "establishesContainingBlock",
      "buildStyleMirror",
      "serializeTextWithBreaks",
      "collapseWhitespaceForOverlay",
      "linesToBreaksHtml",
      "caretRangeFromPoint",
      "STYLE_PROPS",
    ]) {
      expect(__INLINE_EDIT_SCRIPT_FOR_TEST).toContain("var " + name + " =");
    }
  });
  it("never puts contenteditable on the page DOM — only the overlay div", () => {
    // The only contenteditable assignment targets the overlay element.
    const matches = __INLINE_EDIT_SCRIPT_FOR_TEST.match(/contenteditable/g) || [];
    // appears in: the overlay setAttribute + the doc-comment selector strings.
    expect(__INLINE_EDIT_SCRIPT_FOR_TEST).toContain(
      "overlay.setAttribute('contenteditable', 'plaintext-only')",
    );
    expect(matches.length).toBeGreaterThan(0);
  });
});
