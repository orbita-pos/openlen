// Unit tests for Subsystem B pure helpers (jsdom).
import { describe, it, expect } from "vitest";
import {
  rectsToRows,
  rowsMatch,
  childIndexPath,
  nodeAtPath,
  shouldUseGhostLayout,
} from "./ghost-sibling-layout";

function el(html: string): HTMLElement {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.firstElementChild as HTMLElement;
}

describe("rectsToRows", () => {
  it("clusters fragments on the same line into one row (min-left)", () => {
    // line 1: two fragments (text + trailing-space) at top=10; line 2 at top=30
    const rows = rectsToRows([
      { top: 10, left: 100, width: 200, height: 16 },
      { top: 10, left: 300, width: 4, height: 16 }, // trailing space, same line
      { top: 30, left: 100, width: 80, height: 16 },
    ]);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ top: 10, left: 100 });
    expect(rows[1]).toEqual({ top: 30, left: 100 });
  });
  it("drops zero-area rects", () => {
    const rows = rectsToRows([
      { top: 10, left: 50, width: 0, height: 16 },
      { top: 10, left: 60, width: 100, height: 16 },
    ]);
    expect(rows).toEqual([{ top: 10, left: 60 }]);
  });
  it("returns [] for no real rects", () => {
    expect(rectsToRows([])).toEqual([]);
  });
});

describe("rowsMatch", () => {
  const A = [{ top: 100, left: 200 }, { top: 130, left: 176 }];
  it("matches identical structure after first-row alignment", () => {
    // b shifted by (+5,+3) but same relative per-line offsets → match
    const B = [{ top: 103, left: 205 }, { top: 133, left: 181 }];
    expect(rowsMatch(A, B, 1.5)).toBe(true);
  });
  it("rejects different per-line offset (the bug we fix)", () => {
    // line 2 centered alone (left 236) instead of with siblings (176)
    const B = [{ top: 100, left: 200 }, { top: 130, left: 236 }];
    expect(rowsMatch(A, B, 1.5)).toBe(false);
  });
  it("rejects different line counts", () => {
    expect(rowsMatch(A, [{ top: 100, left: 200 }], 2)).toBe(false);
  });
  it("rejects empties", () => {
    expect(rowsMatch([], [], 2)).toBe(false);
  });
});

describe("childIndexPath / nodeAtPath", () => {
  it("round-trips a deep text node", () => {
    const root = el("<h1>Built at <span>great <em>scale</em></span> today</h1>");
    const em = root.querySelector("em")!;
    const tn = em.firstChild as Text; // "scale"
    const path = childIndexPath(root, tn);
    expect(path).not.toBeNull();
    expect(nodeAtPath(root, path!)).toBe(tn);
  });
  it("resolves the SAME position inside a clone", () => {
    const root = el("<p>a <b>bold</b> c <i>it</i> d</p>");
    const target = root.querySelector("i")!.firstChild as Text; // "it"
    const path = childIndexPath(root, target)!;
    const clone = root.cloneNode(true) as HTMLElement;
    const cloneTarget = nodeAtPath(clone, path);
    expect(cloneTarget).toBeTruthy();
    expect((cloneTarget as Text).data).toBe("it");
    expect(cloneTarget).not.toBe(target); // it's the clone's node
  });
  it("returns null when node is not under root", () => {
    const root = el("<p>x</p>");
    const other = el("<p>y</p>");
    expect(childIndexPath(root, other.firstChild!)).toBeNull();
  });
  it("nodeAtPath returns null for an out-of-range path", () => {
    const root = el("<p>x</p>");
    expect(nodeAtPath(root, [5])).toBeNull();
  });
});

describe("shouldUseGhostLayout", () => {
  it("triggers for a centered multi-line run sharing inline content", () => {
    expect(
      shouldUseGhostLayout({ fragmentCount: 2, textAlign: "center", hasOtherInlineContent: true, hasFloatContext: false }),
    ).toBe(true);
  });
  it("triggers for float-wrap regardless of alignment", () => {
    expect(
      shouldUseGhostLayout({ fragmentCount: 2, textAlign: "start", hasOtherInlineContent: false, hasFloatContext: true }),
    ).toBe(true);
  });
  it("does NOT trigger for single-line (glyph-anchor already exact)", () => {
    expect(
      shouldUseGhostLayout({ fragmentCount: 1, textAlign: "center", hasOtherInlineContent: true, hasFloatContext: true }),
    ).toBe(false);
  });
  it("does NOT trigger for start-aligned standalone multi-line (text-indent handles it)", () => {
    expect(
      shouldUseGhostLayout({ fragmentCount: 3, textAlign: "start", hasOtherInlineContent: false, hasFloatContext: false }),
    ).toBe(false);
  });
  it("does NOT trigger for centered multi-line with NO other inline content (block-container handles it)", () => {
    expect(
      shouldUseGhostLayout({ fragmentCount: 2, textAlign: "center", hasOtherInlineContent: false, hasFloatContext: false }),
    ).toBe(false);
  });
});
