import { auth } from "@/auth";
import { NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// Route guard.
//
// /new and any future authenticated-only routes redirect to /login when the
// user has no session. Auth pages and the homepage stay public. Auth.js
// internal routes (/api/auth/*) are always allowed.
// ─────────────────────────────────────────────────────────────────────────────

// Routes whose subtree requires an authenticated session for page access.
// Anything not listed here flows through to the route handler — unknown
// URLs land on the global 404 instead of being bounced to /login.
//
// API routes are NOT gated by this middleware: each `/api/*` handler runs
// its own auth() check and returns 401 on its own. That keeps API responses
// honest (401 means unauthorized, not "redirect to login HTML").
const PROTECTED_PAGE_PREFIXES = ["/new", "/new-v2", "/projects"];

function isProtected(pathname: string): boolean {
  for (const p of PROTECTED_PAGE_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return true;
  }
  return false;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
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
