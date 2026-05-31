import { defineRouting } from "next-intl/routing";

// English + Spanish + 8 more, all locale-prefixed. `/` negotiates from
// Accept-Language and 308-redirects to the best match (English fallback).
// localeCookie disabled on purpose — locale lives in the URL; a NEXT_LOCALE
// Set-Cookie on public marketing routes would break Cloudflare edge caching.
export const routing = defineRouting({
  locales: ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"],
  defaultLocale: "en",
  localePrefix: "always",
  localeCookie: false,
});

export type Locale = (typeof routing.locales)[number];
