import { auth } from "@/auth";
import { NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// Route guard.
//
// /new-v2 and any future authenticated-only routes redirect to /login when
// the user has no session. Auth pages and the homepage stay public. Auth.js
// internal routes (/api/auth/*) are always allowed.
//
// Legacy /new → /new-v2 redirect: the old V1 workspace was retired; any
// inbound link to /new (cached search results, third-party blog posts,
// shared deep links with ?brief=…) now lands on the V2 workspace. Query
// params survive the redirect via the `search` copy below.
// ─────────────────────────────────────────────────────────────────────────────

const PROTECTED_PAGE_PREFIXES = ["/new-v2", "/projects"];

function isProtected(pathname: string): boolean {
  for (const p of PROTECTED_PAGE_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return true;
  }
  return false;
}

export default auth((req) => {
  const { pathname, search } = req.nextUrl;

  // Legacy /new redirect — keep search params so /new?brief=… → /new-v2?mode=ai&brief=…
  if (pathname === "/new" || pathname.startsWith("/new/")) {
    const url = new URL("/new-v2", req.nextUrl.origin);
    if (search) {
      const incoming = new URLSearchParams(search);
      // If brief is present, force ?mode=ai so the V2 page enters the AI
      // flow with the brief pre-filled. Other params (publish, etc.)
      // ride along.
      if (incoming.has("brief") && !incoming.has("mode")) {
        incoming.set("mode", "ai");
      }
      url.search = "?" + incoming.toString();
    }
    return NextResponse.redirect(url);
  }

  if (!isProtected(pathname)) return NextResponse.next();

  if (!req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    // Run middleware on everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|css|js|map)$).*)",
  ],
};
