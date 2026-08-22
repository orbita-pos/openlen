import { profileMeta } from "@/lib/business-profiles/seed-html";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type { EnsurePageMetaOptions } from "@/lib/publish/ensure-page-meta";

/**
 * Where the metadata already in the document came from — which is the only
 * thing that decides whether `ensurePageMeta` preserves it or replaces it.
 *
 * - `authored`: a human may have written this `<head>`. Pasted HTML, a
 *   free-form generation, anything re-saved from the editor. Preserve it;
 *   overwriting a title someone chose is destroying their work.
 * - `cloned`: the metadata belongs to whoever wrote the SOURCE. A curated
 *   template ships real marketing copy (`templates/starter/abismo.html` opens
 *   with `<title>ABISMO — Terror atmosférico…</title>` and an og:description
 *   about a game), and preserving it means the user's browser tab, Google
 *   result and WhatsApp card advertise someone else's product.
 */
export type PageProvenance = "authored" | "cloned";

/**
 * The one place the `ensurePageMeta` option shape is decided. There were four
 * of them spread across the surfaces, and the disagreement was not cosmetic:
 * `replaceStaleMeta`'s own doc comment says it belongs to "the paths that mint
 * a page by cloning one of OUR templates", and `from-template` — that exact
 * path — was the one not passing it, while `assemble` and the curate finalizer
 * did. A shape that lives in each caller drifts from its own rule; a shape
 * derived from provenance cannot.
 */
export function pageMetaFor(input: {
  readonly provenance: PageProvenance;
  /** Preferred title. On a clone this REPLACES the source's; leave it empty to
   *  keep a page-specific title (see the subpage note in from-template). */
  readonly title?: string;
  /** Business whose logo/og-image the page should inherit. Omit when there is
   *  no profile in hand — the defaults still apply. */
  readonly profile?: BusinessProfileData;
}): EnsurePageMetaOptions {
  return {
    ...(input.title ? { title: input.title } : {}),
    ...(input.profile ? profileMeta(input.profile) : {}),
    ...(input.provenance === "cloned" ? { replaceStaleMeta: true } : {}),
  };
}
