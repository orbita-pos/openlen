import { auth } from "@/auth";
import { NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// Route guard.
//
// /new and any future authenticated-only routes redirect to /login when the
// user has no session. Auth pages and the homepage stay public. Auth.js
// internal routes (/api/auth/*) are always allowed.
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC_ROUTES = [
  "/",
  "/templates",
  "/login",
  "/register",
  "/forgot",
  "/preview-blocks",
  "/robots.txt",
  "/sitemap.xml",
];

// Prefixes whose entire subtree is public (detail pages, iframe templates,
// reset tokens).
const PUBLIC_PREFIXES = ["/templates/", "/reset/"];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/auth")) return NextResponse.next();
  if (PUBLIC_ROUTES.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

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
