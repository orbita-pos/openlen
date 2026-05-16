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
  "/login",
  "/register",
  "/forgot",
  "/preview-blocks",
  // /reset/<token> matches via the startsWith check below
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Auth.js handles its own routes
  if (pathname.startsWith("/api/auth")) return NextResponse.next();

  // Public marketing + auth pages
  if (PUBLIC_ROUTES.includes(pathname)) return NextResponse.next();
  if (pathname.startsWith("/reset/")) return NextResponse.next();

  // Static + image assets are excluded by the `matcher` below — anything
  // remaining here is an app route that requires auth.
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
