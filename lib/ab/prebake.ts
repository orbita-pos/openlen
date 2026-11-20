// WHAT CONTROL GETS BEFORE THE BAKE, VARIANT B GETS TOO (review item 16). `publishProject` completes control's <head>
// (`ensurePageMeta`, the raster og:image) and swaps Stripe's test ids for the live ones (`toLive`) before it hands the
// documents to `publishToDir`. Variant B arrives as sources too, so it takes the same steps — otherwise it ships with
// test-mode ids and without meta tags or a link card.
import { ensureSocialOgImage } from "@/lib/branding/social-image";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import type { AbPublishSpec } from "@/lib/publish/filesystem";
import { pageMetaFor } from "@/lib/publish/page-meta-intent";

export async function prebakeVariantB(
  spec: AbPublishSpec,
  ctx: {
    readonly title: string;
    readonly baseUrl: string;
    /** Stripe's test ids → the live ones (`swapTwins`), or null when nothing was copied to live mode. */
    readonly toLive: ((text: string) => string) | null;
  },
): Promise<AbPublishSpec> {
  const live = ctx.toLive ?? ((text: string) => text);
  let html = spec.variantB.html;
  // Only a HOME variant is published as a document of its own: control's subpages don't get the head pass either.
  if (spec.targetPath === "/") {
    html = ensurePageMeta(html, pageMetaFor({ provenance: "authored", title: ctx.title }));
    try {
      html = await ensureSocialOgImage(html, { title: ctx.title, baseUrl: ctx.baseUrl });
    } catch (err) {
      // Soft, as for control: a hiccup must never block a publish.
      // eslint-disable-next-line no-console
      console.warn("[publish] Variant B's social og:image failed; continuing", err);
    }
  }
  return {
    ...spec,
    variantB: {
      html: live(html),
      ...(spec.variantB.pages ? { pages: spec.variantB.pages.map((p) => ({ ...p, html: live(p.html) })) } : {}),
      ...(spec.variantB.files ? { files: spec.variantB.files.map((f) => ({ ...f, content: live(f.content) })) } : {}),
    },
  };
}
