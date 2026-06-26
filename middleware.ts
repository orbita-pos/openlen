import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import NextAuth from "next-auth";
import authConfig from "@/auth.config";
import { routing } from "@/i18n/routing";

// ─────────────────────────────────────────────────────────────────────────────
// Middleware = next-intl locale routing + Auth.js route guard, composed.
//
//   • Public routes (/, /<locale>, /<locale>/templates, /<locale>/blog, …)
//     run ONLY the intl middleware. They never touch `auth()`, so no
//     csrf/session Set-Cookie is emitted and Cloudflare can still cache them
//     (with localeCookie disabled in routing.ts, the intl middleware emits no
//     Set-Cookie either).
//
//   • Protected routes (/<locale>/new, /<locale>/projects) run through
//     `auth()`. No session → redirect to the localized /login with ?next=.
//     With a session, the intl middleware runs to finish locale handling.
//
//   • Old /new-v2 (and /<locale>/new-v2) → /<locale>/new, preserving query.
//     On /new itself a ?brief=… link without ?mode forces ?mode=ai so the
//     workspace opens the AI flow with the brief pre-filled.
// ─────────────────────────────────────────────────────────────────────────────

const intlMiddleware = createIntlMiddleware(routing);
const locales = routing.locales as readonly string[];

// Edge-safe auth instance built from the DB-free config (auth.config.ts).
// Importing `auth` from "@/auth" here would pull the node-postgres driver into
// the middleware's edge bundle and break `next build`.
const { auth } = NextAuth(authConfig);

const PROTECTED = ["/new", "/projects"];

function localeFromPath(pathname: string): string {
  const seg = pathname.split("/")[1];
  return locales.includes(seg) ? seg : routing.defaultLocale;
}

function pathWithoutLocale(pathname: string): string {
  const seg = pathname.split("/")[1];
  if (locales.includes(seg)) {
    const rest = pathname.slice(seg.length + 1);
    return rest === "" ? "/" : rest;
  }
  return pathname;
}

function isProtected(pathname: string): boolean {
  const bare = pathWithoutLocale(pathname);
  return PROTECTED.some((p) => bare === p || bare.startsWith(p + "/"));
}

// Cheap session-cookie presence check — deliberately does NOT decrypt or call
// auth(), so a cookieless (logged-out) visitor is untouched and /login + /register
// stay cacheable. Auth.js v5 names the JWT cookie authjs.session-token (http) /
// __Secure-authjs.session-token (https), optionally .0/.1 chunked for big tokens.
function hasSessionCookie(req: NextRequest): boolean {
  return req.cookies
    .getAll()
    .some((c) => /^(__Secure-)?authjs\.session-token(\.\d+)?$/.test(c.name));
}

// Mirror register/login page sanitizeNext: keep an in-app ?next= path, reject
// offsite / protocol-relative values.
function sanitizeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/new";
  return raw;
}

// Auth-gated branch. `auth()` augments the request with `.auth`; when a
// session exists we hand off to the intl middleware to complete locale
// resolution. The cast bridges Auth.js's (req, ctx) handler signature to the
// single-arg call we make here — ctx is unused.
const authMiddleware = auth((req) => {
  if (!req.auth) {
    const locale = localeFromPath(req.nextUrl.pathname);
    const loginUrl = new URL(`/${locale}/login`, req.nextUrl.origin);
    // Store the locale-LESS path: the login page feeds `next` into next-intl's
    // locale-aware redirect/router, which re-prefixes it. A prefixed value here
    // would double up (/en/new → /en/en/new → 404). Matches every other caller
    // (projects/page.tsx, use-template-button, …) which pass bare paths.
    loginUrl.searchParams.set("next", pathWithoutLocale(req.nextUrl.pathname));
    return fixRedirectHost(NextResponse.redirect(loginUrl));
  }
  return fixRedirectHost(intlMiddleware(req));
}) as unknown as (req: NextRequest) => ReturnType<typeof intlMiddleware>;

// Behind the Caddy proxy, Next builds absolute redirects from the upstream
// authority — the internal PORT (3000) leaks into the Location
// (https://openlen.com:3000/en), and the host can surface as localhost. Both
// break real visitors. We REBUILD the redirect with a clean canonical URL:
// mutating the Location header alone doesn't stick, because Next re-serializes
// the response from the URL the redirect was created with.
//
// Trigger is dev-safe without a NODE_ENV gate: it only fires when the target is
// our own domain carrying a stray port, or a leaked localhost in production.
// In dev the redirect target is plain localhost:3000 (correct) → untouched.
const IS_PROD = process.env.NODE_ENV === "production";

function fixRedirectHost(res: NextResponse): NextResponse {
  const loc = res.headers.get("location");
  if (!loc) return res;
  let u: URL;
  try {
    u = new URL(loc, "https://openlen.com");
  } catch {
    return res;
  }
  const h = u.hostname;
  const ourHostWithPort =
    (h === "openlen.com" || h === "www.openlen.com") && !!u.port;
  const leakedLocalhost =
    IS_PROD && (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0");
  if (!ourHostWithPort && !leakedLocalhost) return res;

  u.protocol = "https:";
  u.hostname = "openlen.com";
  u.port = "";
  const fixed = NextResponse.redirect(u, res.status);
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "location") fixed.headers.set(key, value);
  });
  return fixed;
}

export default function middleware(req: NextRequest): ReturnType<typeof intlMiddleware> {
  const { pathname, search } = req.nextUrl;
  const bare = pathWithoutLocale(pathname);

  // The workspace lives at /new. Old /new-v2 links + bookmarks → /new,
  // preserving any query.
  if (bare === "/new-v2" || bare.startsWith("/new-v2/")) {
    const url = new URL(
      pathname.replace("/new-v2", "/new"),
      req.nextUrl.origin,
    );
    if (search) url.search = search;
    return fixRedirectHost(NextResponse.redirect(url));
  }

  // A brief in the URL without an explicit mode opens the AI entry flow.
  if (bare === "/new") {
    const params = new URLSearchParams(search);
    if (params.has("brief") && !params.has("mode")) {
      params.set("mode", "ai");
      const url = new URL(pathname, req.nextUrl.origin);
      url.search = "?" + params.toString();
      return fixRedirectHost(NextResponse.redirect(url));
    }
  }

  // Already-authenticated users hitting /login or /register: the pages' own
  // auth() guard redirects them to /new, but only AFTER the route's loading.tsx
  // skeleton paints — a visible ~1s flash while the slow auth() round-trip
  // resolves. Catch it at the edge instead so no auth-card segment ever renders;
  // honor ?next= so the Hero brief flow keeps flowing through to /new?mode=ai.
  if ((bare === "/login" || bare === "/register") && hasSessionCookie(req)) {
    const locale = localeFromPath(pathname);
    const target = sanitizeNext(req.nextUrl.searchParams.get("next"));
    return fixRedirectHost(
      NextResponse.redirect(new URL(`/${locale}${target}`, req.nextUrl.origin)),
    );
  }

  if (isProtected(pathname)) {
    return authMiddleware(req);
  }
  return fixRedirectHost(intlMiddleware(req));
}

export const config = {
  // Run on every browsable path so `/` negotiates a locale. Excludes API
  // routes, Next internals, the published-page handlers (served, c), the
  // token-gated draft preview (p/) and any path with a dot (static assets +
  // metadata files: robots.txt, sitemap.xml, icon.svg, og.png, favicon.ico, …).
  // `p/` (with the slash) excludes only /p/<id> — NOT /projects, /pricing, …
  // which start with a bare `p`.
  matcher: ["/((?!api|_next|_vercel|served|c|p/|.*\\..*).*)"],
};
