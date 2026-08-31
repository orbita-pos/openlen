import { publishedHost } from "@/lib/publish/base-host";
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

// El TELÉFONO y el WHATSAPP salen de la PÁGINA, no de una ficha (2026-08-31).
//
// Antes venían del perfil de negocio; al retirarlo, la alternativa honesta era
// leerlos de donde ya están: los `href` que el visitante puede pulsar. Es la
// misma fuente que usa `lib/agent/facts-kept.ts` para saber qué hechos no puede
// perder un rediseño — un `tel:` y un `wa.me` son ESTRUCTURA, no prosa.
//
// Lo que deliberadamente NO se saca de aquí: la dirección y el lema. Los dos son
// prosa suelta en el cuerpo, sin marca que los distinga de cualquier otro
// párrafo, y adivinarlos pondría una frase equivocada en un cartel. Un dato
// ausente deja el hueco; un dato inventado se publica.
export function extractPageContact(html: string): {
  phone?: string;
  whatsapp?: string;
} {
  let phone: string | undefined;
  let whatsapp: string | undefined;
  for (const m of html.matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"']+)["']/gi)) {
    const href = m[1]!.trim();
    if (!whatsapp) {
      // Las dos formas que el modelo escribe: wa.me/<numero> y
      // api.whatsapp.com/send?phone=<numero>.
      const wa = /(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\+?\d{6,})/i.exec(href);
      if (wa) whatsapp = wa[1];
    }
    if (!phone && /^tel:/i.test(href)) {
      const t = href.slice(4).trim();
      if (t) phone = t;
    }
    if (phone && whatsapp) break;
  }
  return { ...(phone ? { phone } : {}), ...(whatsapp ? { whatsapp } : {}) };
}

/** The `pos` query param "50,30" → a CSS object-position "50% 30%" (clamped 0-100), else undefined. */
export function parsePhotoPos(raw: string | null): string | undefined {
  if (!raw || !/^\d{1,3},\d{1,3}$/.test(raw)) return undefined;
  const [x, y] = raw.split(",").map((n) => Math.max(0, Math.min(100, Number(n))));
  return `${x}% ${y}%`;
}

export function buildPostData(input: {
  html: string; subdomain: string | null;
  userOffer?: string; photoUrl?: string; pageTitle?: string;
  register?: PostRegister;
  /** Focal point for the cover-cropped photo, e.g. "50% 30%" (drag-to-reposition). */
  photoPosition?: string;
  /** "Combinar con mi página" — derive palette + font from the page. Default on. */
  match?: boolean;
}): PostData {
  const contacto = extractPageContact(input.html);
  const businessName = norm(input.pageTitle);
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
  const brandAccent = normHex(extractRootToken(input.html, "--accent"));
  const doMatch = input.match !== false && !!brandAccent;
  const pageBg = normHex(extractRootToken(input.html, "--bg"))
    ?? normHex(extractRootToken(input.html, "--background"));
  const palette = doMatch ? derivePalette(brandAccent!, pageBg) : null;
  const font = doMatch ? extractPageFont(input.html) : null;

  return {
    businessName,
    offer: norm(input.userOffer),
    phone: norm(contacto.phone),
    whatsapp: norm(contacto.whatsapp),
    url: input.subdomain ? publishedHost(input.subdomain) : undefined,
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
