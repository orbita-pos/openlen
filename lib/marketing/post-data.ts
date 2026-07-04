import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type { PostData } from "./fill";
import type { PostRegister } from "./post-templates/families";

export function extractRootToken(html: string, varName: string): string | null {
  const root = html.match(/:root\s*\{([^}]*)\}/);
  if (!root) return null;
  const m = root[1].match(new RegExp(`${varName}\\s*:\\s*([^;}]+)`));
  return m ? m[1].trim() : null;
}

export function extractPagePhotos(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<img[^>]*\ssrc="(https?:\/\/[^"]+)"/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
    if (out.length >= 12) break;
  }
  return out;
}

// Captions are for the page's AUDIENCE, not the editor's UI locale (spec §4)
// — derive from the published <html lang>, not next-intl's useLocale(). Any
// "es-*" subtag (es-MX, es-419, ...) maps to "es"; missing/unrecognized attr
// defaults to "es" (es-MX-first product, per lib/design-guidance.ts).
export function extractPageLang(html: string): "es" | "en" {
  const m = /<html[^>]*\blang="([a-zA-Z-]+)"/.exec(html);
  if (!m) return "es";
  return m[1].toLowerCase().startsWith("es") ? "es" : "en";
}

// The curated default photo per register — the design is born beautiful with
// THIS image (picked from the "Imágenes by OpenLen" catalog,
// public/openlen-images/manifest.json). The user can replace it with their own
// from the detail photo strip; if theirs looks off, that's their call. We do
// NOT auto-pull the business's own page images (they're often logos/sprites
// that crop ugly) — see buildPostData.
//
// `null` = the register looks best as pure type (no photo box filled). oficios
// is phone-first by design ("el teléfono es el elemento más importante") and
// the catalog has no on-register trades photo, so it stays type-only. general
// designs carry no photo box at all.
export const REGISTER_DEFAULT_PHOTOS: Record<PostRegister, string | null> = {
  restaurante: "https://images.openlen.com/160-plated-fine-dining-1920.webp",
  belleza: "https://images.openlen.com/200-spa-interior-1920.webp",
  gym: "https://images.openlen.com/365-weightlifter-1920.webp",
  consultorio: "https://images.openlen.com/197-focus-pod-1920.webp",
  tienda: "https://images.openlen.com/188-retail-interior-1920.webp",
  oficios: null,
  general: null,
};

const norm = (s: string | null | undefined) => (s && s.trim()) || undefined;

export function buildPostData(input: {
  html: string; subdomain: string | null;
  profile: BusinessProfileData | null;
  userOffer?: string; photoUrl?: string; pageTitle?: string;
  register?: PostRegister;
}): PostData {
  const p = input.profile;
  const businessName = norm(p?.business_name) ?? norm(input.pageTitle);
  // Curated-beauty posture (2026-07-04): fill only the SAFE text. We do NOT
  // override the design's hand-picked accent with the business's brand color
  // (an arbitrary brand hue on a design's fixed background turns to mud — the
  // design was color-tuned as-is), and we do NOT auto-inject the business's
  // own page images. The photo defaults to the register's curated image; the
  // user opts into their own from the detail strip.
  const registerPhoto = input.register
    ? REGISTER_DEFAULT_PHOTOS[input.register]
    : null;
  return {
    businessName,
    tagline: norm(p?.tagline_es) ?? norm(p?.tagline_en),
    offer: norm(input.userOffer),
    phone: norm(p?.contact?.phone),
    whatsapp: norm(p?.contact?.whatsapp),
    address: norm(p?.contact?.address),
    url: input.subdomain ? `${input.subdomain}.openlen.com` : undefined,
    logoInitial: businessName ? businessName[0].toUpperCase() : undefined,
    photoUrl: norm(input.photoUrl) ?? registerPhoto ?? undefined,
  };
}
