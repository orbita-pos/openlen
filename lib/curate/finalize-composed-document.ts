import { seedBrandIntoHtml } from "@/lib/business-profiles/seed-html";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { sanitizeForPublish } from "@/lib/html-engine";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import { pageMetaFor } from "@/lib/publish/page-meta-intent";
import { ensureSingleH1 } from "./ensure-single-h1";

export function finalizeComposedDocument(input: {
  html: string;
  profileData: BusinessProfileData;
  title: string;
}): { ok: true; html: string } | { ok: false; reasonCode: "sanitization_failed" } {
  const seeded = ensureSingleH1(seedBrandIntoHtml(input.html, input.profileData, { recolor: false })).html;
  const withMeta = ensurePageMeta(
    seeded,
    // CLONED: stitched from library sections, whose <head> carries their own
    // demo metadata.
    pageMetaFor({ provenance: "cloned", title: input.title, profile: input.profileData }),
  );
  const sanitized = sanitizeForPublish(withMeta);
  return sanitized.html === null
    ? { ok: false, reasonCode: "sanitization_failed" }
    : { ok: true, html: sanitized.html };
}
