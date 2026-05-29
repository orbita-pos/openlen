// Editor V5 final-push — Subsystem B: ghost-sibling layout.
//
// PROBLEM. The floating overlay edits a single run/element in isolation, so its
// wrap geometry depends only on the run's own box. When the run's lines share
// the inline formatting context with OTHER content — a centered/justified line
// that also holds a sibling mark (`…at <span>scale</span>` centered together),
// or a paragraph whose lines reflow around a floated figure — the isolated
// overlay can't know about that content and mis-places lines 2+.
//
// SOLUTION (clone-as-editor). Clone the smallest ancestor whose clone, rendered
// in the same context, REPRODUCES the target's on-page line positions; make only
// the target text node editable inside that clone; edit there (full sibling /
// float / alignment context is present, so the browser lays the run out exactly
// as the page does). The clone is validated against the original's measured rows
// before use — if no ancestor up to a cap reproduces the layout, the caller
// FALLS BACK to the normal overlay (zero regression by construction).
//
// This file holds the PURE, self-contained helpers (unit-tested + serialized
// into the iframe runtime via .toString()); the clone/position/commit
// orchestration lives in use-inline-edit.ts. Self-containment rules from
// inline-edit-core.ts apply (no cross-export calls, ES5 style, inline helpers).

/** A glyph line: its top + left edge in viewport px. */
export interface GhostRow {
  top: number;
  left: number;
}

/**
 * Cluster raw client rects (one per inline fragment) into LINE rows by vertical
 * band, taking each row's min-left / min-top. Pure — takes plain rects so it is
 * unit-testable without layout. Mirrors the diagnostic's row clustering so
 * "reproduces the layout" means the same thing the corpus metric measures.
 */
export function rectsToRows(
  rects: ReadonlyArray<{ top: number; left: number; right?: number; width?: number; height: number }>,
): GhostRow[] {
  var list = [];
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i];
    var w = r.width != null ? r.width : (r.right != null ? r.right - r.left : 0);
    if (w > 0.5 && r.height > 0.5) list.push(r);
  }
  list.sort(function (a, b) { return a.top - b.top || a.left - b.left; });
  var rows: GhostRow[] = [];
  for (var j = 0; j < list.length; j++) {
    var rr = list[j];
    var band = Math.max(4, rr.height / 2);
    var found = null;
    for (var k = 0; k < rows.length; k++) {
      if (Math.abs(rows[k].top - rr.top) <= band) { found = rows[k]; break; }
    }
    if (found) {
      if (rr.left < found.left) found.left = rr.left;
      if (rr.top < found.top) found.top = rr.top;
    } else {
      rows.push({ top: rr.top, left: rr.left });
    }
  }
  rows.sort(function (a, b) { return a.top - b.top; });
  return rows;
}

/**
 * True when two row sets match line-for-line within `tol` px on BOTH axes,
 * after shifting `b` by (dx,dy) so the FIRST rows coincide (the clone may sit a
 * few px off; we care that the line STRUCTURE — relative per-line offsets —
 * matches). Pure. Used to validate a candidate clone reproduces the page layout.
 */
export function rowsMatch(
  a: ReadonlyArray<GhostRow>,
  b: ReadonlyArray<GhostRow>,
  tol: number,
): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  var dx = b[0].left - a[0].left;
  var dy = b[0].top - a[0].top;
  for (var i = 0; i < a.length; i++) {
    if (Math.abs((b[i].left - dx) - a[i].left) > tol) return false;
    if (Math.abs((b[i].top - dy) - a[i].top) > tol) return false;
  }
  return true;
}

/**
 * Index path (childNodes offsets) from `root` down to `node`, or null if node is
 * not a descendant. Lets us re-find the same text node inside a deep clone.
 * Pure DOM — jsdom-testable, self-contained.
 */
export function childIndexPath(root: Node, node: Node): number[] | null {
  var path: number[] = [];
  var n: Node | null = node;
  while (n && n !== root) {
    var par: ParentNode | null = n.parentNode;
    if (!par) return null;
    var idx = -1;
    var kids: NodeListOf<ChildNode> = par.childNodes;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] === n) { idx = i; break; }
    }
    if (idx === -1) return null;
    path.unshift(idx);
    n = par as Node;
  }
  return n === root ? path : null;
}

/** Resolve an index path produced by childIndexPath against `root`. Pure DOM. */
export function nodeAtPath(root: Node, path: ReadonlyArray<number>): Node | null {
  var n: Node | null = root;
  for (var i = 0; i < path.length; i++) {
    if (!n) return null;
    var kids: NodeListOf<ChildNode> = n.childNodes;
    if (path[i] < 0 || path[i] >= kids.length) return null;
    n = kids[path[i]];
  }
  return n;
}

/**
 * Decide whether the ghost-sibling path is worth attempting for a target. We
 * only attempt it when the SIMPLE overlay can actually go wrong — i.e. the run
 * WRAPS (more than one line) AND its lines can be co-determined by other content
 * (a non-start alignment centers/justifies the line as a whole, OR the block
 * container holds inline/floated content beyond the target). Single-line runs
 * are already glyph-anchored exactly; start-aligned standalone multi-line is
 * already handled by the text-indent placement. Pure.
 */
export function shouldUseGhostLayout(opts: {
  fragmentCount: number;
  textAlign: string;
  hasOtherInlineContent: boolean;
  hasFloatContext: boolean;
}): boolean {
  if (!opts || opts.fragmentCount <= 1) return false;
  var aligned =
    opts.textAlign === "center" ||
    opts.textAlign === "justify" ||
    opts.textAlign === "right" ||
    opts.textAlign === "end";
  return (aligned && opts.hasOtherInlineContent) || opts.hasFloatContext;
}
