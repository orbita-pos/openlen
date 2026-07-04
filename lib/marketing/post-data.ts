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

// One curated fallback per register (spec §7), picked from the "Imágenes by
// OpenLen" catalog (public/openlen-images/manifest.json) — verified 200 via
// curl at implementation time. Kept on images.openlen.com so the bake
// allowlist stays happy if reused later.
export const REGISTER_FALLBACK_PHOTOS: Record<PostRegister, string> = {
  restaurante: "https://images.openlen.com/160-plated-fine-dining-1920.webp",
  belleza: "https://images.openlen.com/200-spa-interior-1920.webp",
  gym: "https://images.openlen.com/365-weightlifter-1920.webp",
  consultorio: "https://images.openlen.com/197-focus-pod-1920.webp",
  tienda: "https://images.openlen.com/188-retail-interior-1920.webp",
  oficios: "https://images.openlen.com/275-pottery-wheel-1920.webp",
  general: "https://images.openlen.com/01-warm-glassy-1920.webp",
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
  return {
    businessName,
    tagline: norm(p?.tagline_es) ?? norm(p?.tagline_en),
    offer: norm(input.userOffer),
    phone: norm(p?.contact?.phone),
    whatsapp: norm(p?.contact?.whatsapp),
    address: norm(p?.contact?.address),
    url: input.subdomain ? `${input.subdomain}.openlen.com` : undefined,
    logoInitial: businessName ? businessName[0].toUpperCase() : undefined,
    photoUrl:
      norm(input.photoUrl) ??
      extractPagePhotos(input.html)[0] ??
      (input.register ? REGISTER_FALLBACK_PHOTOS[input.register] : undefined),
    accent: norm(p?.brand?.accent) ?? extractRootToken(input.html, "--accent") ?? undefined,
  };
}
