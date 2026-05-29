// Editor V5 final-push — Subsystem A: 3D / animated ancestor handling.
//
// PROBLEM. A target inside a `matrix3d(...)` ancestor (rotateY flip-cards,
// perspective tilts) is rendered with a 3D projection. A flat, body-level
// overlay cannot match that projection — its glyphs land tens-to-thousands of px
// off (e.g. atrium dx = -2076). Hand-composing the ancestor DOMMatrix chain +
// perspective division to place a flat overlay is error-prone (perspective is a
// projective, non-affine transform; a 2D left/top nudge does not linearly
// correct a projected element).
//
// SOLUTION (in-context clone). Let the BROWSER compose the transform. Clone the
// target's block container and insert it as a sibling INSIDE the same 3D-/
// animated- ancestor, positioned at the block's LOCAL (pre-projection) box
// (offsetLeft/offsetTop/offsetWidth). The clone inherits the identical ancestor
// transform chain + perspective + perspective-origin, so the browser projects it
// exactly onto the original (validated empirically to ~1px). Because the clone
// lives inside the SAME animating ancestor, it tracks keyframe/scroll-driven
// transform animation automatically — no per-frame matrix recomputation. This
// realizes the spec's "3D-context wrapper that mirrors the perspective chain"
// using the REAL chain. Self-validating: engaged only if the clone's target
// SCREEN rows overlap the original within tolerance, else the caller falls back
// (zero regression by construction).
//
// Pure, self-contained helpers (unit-tested + serialized into the runtime).

/** True when a computed `transform` is a 3D transform (matrix3d / 3D funcs). A
 *  flat 2D matrix(...) is handled by the overlay's normal self-correct, not here.
 *  Pure. */
export function isThreeDTransform(transform: string | null | undefined): boolean {
  if (!transform || transform === "none") return false;
  return (
    transform.indexOf("matrix3d") !== -1 ||
    transform.indexOf("perspective(") !== -1 ||
    transform.indexOf("rotate3d") !== -1 ||
    transform.indexOf("rotateX") !== -1 ||
    transform.indexOf("rotateY") !== -1 ||
    transform.indexOf("translateZ") !== -1 ||
    transform.indexOf("translate3d") !== -1
  );
}

/** A glyph line: top + left in viewport px. */
export interface ScreenRow {
  top: number;
  left: number;
}

/**
 * ABSOLUTE overlap test (no first-row re-alignment, unlike rowsMatch): every row
 * pair must coincide within `tol` px on both axes. Used to confirm an in-context
 * clone projects ONTO the original (we need true overlap, not just matching line
 * structure). Pure.
 */
export function rowsOverlap(
  a: ReadonlyArray<ScreenRow>,
  b: ReadonlyArray<ScreenRow>,
  tol: number,
): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  for (var i = 0; i < a.length; i++) {
    if (Math.abs(a[i].left - b[i].left) > tol) return false;
    if (Math.abs(a[i].top - b[i].top) > tol) return false;
  }
  return true;
}
