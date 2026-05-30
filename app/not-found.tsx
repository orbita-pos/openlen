import Link from "next/link";

// Global fallback not-found. Because the root layout is a passthrough (no
// html/body), this page renders its own minimal shell. In practice the
// middleware redirects every browsable path to a locale prefix, so unmatched
// paths are normally caught by app/[locale]/[...rest] and rendered with the
// localized not-found instead — this exists only for edge paths that bypass
// locale routing entirely.
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-zinc-900 antialiased font-sans">
        <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-sm font-medium text-zinc-400">404</p>
          <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
          <Link
            href="/"
            className="text-sm font-medium text-coral-600 hover:text-coral-700 underline underline-offset-4"
          >
            Back to home
          </Link>
        </main>
      </body>
    </html>
  );
}
