import type { Op } from "@/lib/html-ops";

/**
 * Ops that would write copy into a decorative element, dropped before they are
 * applied.
 *
 * `aria-hidden="true"` is the author saying "this is not content". A screen
 * reader skips it, so anything the filler writes there is text a sighted user
 * sees and the page declares does not exist — and it is sized for decoration,
 * not for words. Measured on `school-website`: the business name went into a
 * one-glyph circle and came out clipped to "Col egi", and the CTA label went
 * into the arrow at the end of every card.
 *
 * The filler is a model, so a rule in its prompt is a request. This is the same
 * rule as an invariant: an op the model should not have proposed never reaches
 * `applyOps`.
 */
export function dropDecorativeOps<T extends Op>(ops: readonly T[], taggedHtml: string): T[] {
  const decorative = decorativeTargets(taggedHtml);
  return decorative.size === 0 ? [...ops] : ops.filter((op) => !decorative.has(op.target));
}

/** Op-ids whose own tag carries `aria-hidden="true"`. Only the element itself:
 *  a target we cannot see is left alone rather than guessed at, because
 *  dropping an op on a hunch silently discards real copy. */
function decorativeTargets(taggedHtml: string): Set<string> {
  const out = new Set<string>();
  for (const tag of taggedHtml.matchAll(/<[a-z][^>]*>/gi)) {
    const text = tag[0];
    if (!/\baria-hidden\s*=\s*("true"|'true'|true)/i.test(text)) continue;
    const id = /\bdata-op-id\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(text);
    const value = id?.[2] ?? id?.[3] ?? id?.[4];
    if (value) out.add(value);
  }
  return out;
}
