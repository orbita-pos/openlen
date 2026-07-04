import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type { PostData } from "./fill";
import type { PostRegister } from "./post-templates/families";
import { derivePalette, extractPageFont, normHex } from "./theme-match";

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

/** The `pos` query param "50,30" → a CSS object-position "50% 30%" (clamped 0-100), else undefined. */
export function parsePhotoPos(raw: string | null): string | undefined {
  if (!raw || !/^\d{1,3},\d{1,3}$/.test(raw)) return undefined;
  const [x, y] = raw.split(",").map((n) => Math.max(0, Math.min(100, Number(n))));
  return `${x}% ${y}%`;
}

export function buildPostData(input: {
  html: string; subdomain: string | null;
  profile: BusinessProfileData | null;
  userOffer?: string; photoUrl?: string; pageTitle?: string;
  register?: PostRegister;
  /** Focal point for the cover-cropped photo, e.g. "50% 30%" (drag-to-reposition). */
  photoPosition?: string;
  /** "Combinar con mi página" — derive palette + font from the page. Default on. */
  match?: boolean;
}): PostData {
  const p = input.profile;
  const businessName = norm(p?.business_name) ?? norm(input.pageTitle);
  // Photo: default = the register's curated image; the user opts into their own
  // from the detail strip. We never auto-inject the business's own page images
  // (they're often logos/sprites that crop ugly — the ORBITAPOS bug).
  const registerPhoto = input.register
    ? REGISTER_DEFAULT_PHOTOS[input.register]
    : null;

  // "Combinar con mi página": derive a CONTRAST-SAFE palette (bg+ink+accent) and
  // display font from the page, so the post is born matched to the brand AND
  // beautiful. Matching one token blindly turned to mud (see theme-match.ts);
  // deriving the whole system with guaranteed contrast does not. Needs a brand
  // color to key off; without one we keep the design's curated look.
  const brandAccent = normHex(p?.brand?.accent) ?? normHex(extractRootToken(input.html, "--accent"));
  const doMatch = input.match !== false && !!brandAccent;
  const pageBg = normHex(extractRootToken(input.html, "--bg"))
    ?? normHex(extractRootToken(input.html, "--background"));
  const palette = doMatch ? derivePalette(brandAccent!, pageBg) : null;
  const font = doMatch ? extractPageFont(input.html) : null;

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
    photoPosition: input.photoPosition,
    accent: palette?.accent,
    bg: palette?.bg,
    ink: palette?.ink,
    fontFamily: font?.family,
    fontHref: font?.href,
  };
}
