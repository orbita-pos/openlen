// THE SHELL OF AN APP ON THE DESKTOP'S WINDOW (spec local 2026-11-26-apps-en-el-escritorio, §4.3). The root layout is a
// passthrough and every page brings its own <html> (`app/[locale]/layout.tsx` does); this one is outside the locale segment,
// so the language is the request's (`requestLocale`). The workspace's tokens, so the strip, the card and the notices wear
// what the workspace wears, and nothing else of the workspace.
import type { Viewport } from "next";

import { EARLY_INSTALL_PROMPT_SCRIPT } from "@/lib/desktop-apps/early-install-prompt";
import { DESKTOP_THEME_COLOR } from "@/lib/desktop-apps/manifest";
import { requestLocale } from "@/lib/desktop-apps/page-request";
import "@/app/globals.css";
import "@/app/[locale]/new/tokens.css";

export const viewport: Viewport = { themeColor: DESKTOP_THEME_COLOR };

// The saved theme (or the system's) before the first paint, as `app/[locale]/layout.tsx` does: the tokens' dark values hang
// on `.dark`, and the window must not flash the other mode. Same storage key as `useDarkMode`.
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('inari:dark');var d=s===null?window.matchMedia('(prefers-color-scheme: dark)').matches:s==='1';if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default async function DesktopLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const [{ id }, locale] = await Promise.all([params, requestLocale()]);
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* `use-credentials`: a manifest is fetched WITHOUT the session otherwise, and this one answers only to its person. */}
        <link rel="manifest" href={`/desktop/${encodeURIComponent(id)}/manifest.webmanifest`} crossOrigin="use-credentials" />
        <script dangerouslySetInnerHTML={{ __html: EARLY_INSTALL_PROMPT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
