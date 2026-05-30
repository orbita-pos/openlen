import { defineRouting } from "next-intl/routing";

// English + Spanish, both locale-prefixed (/en, /es). `/` negotiates from
// Accept-Language and 308-redirects to the best match (English fallback).
//
// localeCookie is disabled on purpose: the locale already lives in the URL,
// so we don't need a NEXT_LOCALE cookie to persist it — and emitting a
// Set-Cookie on public marketing routes would make Cloudflare treat the
// response as user-specific and refuse to cache it (the same reason the
// middleware matcher used to exclude marketing routes entirely).
export const routing = defineRouting({
  locales: ["en", "es"],
  defaultLocale: "en",
  localePrefix: "always",
  localeCookie: false,
});

export type Locale = (typeof routing.locales)[number];
