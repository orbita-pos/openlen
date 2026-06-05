// Overlay a saved business profile onto a model's invented copy: real values
// win where present; the invented copy fills any gaps (a profile only SEEDS).
// Shared by every creation path that fills a known template (curate today;
// from-template/from-html next) — extracted from /api/curate so there's a single
// source of truth.

import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import type { BusinessProfileData } from "./types";

export function overlayProfile(
  copy: ExtractedBusinessData,
  data: BusinessProfileData,
): ExtractedBusinessData {
  const out: ExtractedBusinessData = { ...copy };
  const real = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0;
  if (real(data.business_name)) out.business_name = data.business_name;
  if (real(data.industry)) out.industry = data.industry;
  if (real(data.tagline_es)) out.tagline_es = data.tagline_es;
  if (real(data.tagline_en)) out.tagline_en = data.tagline_en;
  if (real(data.pitch)) out.pitch = data.pitch;
  if (real(data.hero_keyword)) out.hero_keyword = data.hero_keyword;
  if (real(data.cta_primary)) out.cta_primary = data.cta_primary;
  if (real(data.cta_secondary)) out.cta_secondary = data.cta_secondary;
  if (data.features?.length) out.features = data.features;
  if (data.pricing?.length) out.pricing = data.pricing;
  if (data.testimonials?.length) out.testimonials = data.testimonials;
  if (data.faq_questions?.length) out.faq_questions = data.faq_questions;
  if (data.contact && hasRealContact(data.contact)) out.contact = data.contact;
  return out;
}

// Does this profile hold ANY real business info (vs the empty lazy default)?
// Drives the brief screen's "Agregar mi negocio" cold-start CTA: with nothing
// real saved yet, lead with import; once filled, show the switch picker.
export function isProfileFilled(data: BusinessProfileData): boolean {
  const real = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0;
  return (
    real(data.business_name) ||
    real(data.industry) ||
    real(data.tagline_es) ||
    real(data.tagline_en) ||
    real(data.pitch) ||
    hasRealContact(data.contact) ||
    real(data.brand?.accent) ||
    real(data.brand?.logoUrl) ||
    (data.photos?.length ?? 0) > 0
  );
}

// True only if a profile's contact block has at least one real value — so an
// EMPTY default profile overlays nothing and keeps the model's invented copy.
// Also the signal for "this page was generated without real business info".
export function hasRealContact(c: BusinessProfileData["contact"]): boolean {
  if (!c) return false;
  const vals = [
    c.whatsapp,
    c.phone,
    c.email,
    c.address,
    c.socials?.instagram,
    c.socials?.facebook,
    c.socials?.tiktok,
    c.socials?.website,
  ];
  return vals.some((v) => typeof v === "string" && v.trim().length > 0);
}
