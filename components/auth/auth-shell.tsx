"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Moon, Sun } from "lucide-react";
import { useDarkMode } from "@/lib/use-dark-mode";
import { OpenLenMark } from "@/components/openlen-logo";
import type { ReactNode } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Shared chrome for /login /register /forgot /reset.
//
// Grid background + coral hero glow at the top, sticky header with brand +
// dark-mode toggle, centered max-w-[420px] card slot, footer with legal +
// links. Children render inside the centered slot.
// ─────────────────────────────────────────────────────────────────────────────

export function AuthShell({ children }: { children: ReactNode }) {
  const t = useTranslations("auth");
  const [dark, toggleDark] = useDarkMode();

  return (
    <div className="relative min-h-screen flex flex-col bg-white text-zinc-900 dark:bg-[#0a0a0a] dark:text-zinc-100">
      <div className="absolute inset-0 grid-bg opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute inset-x-0 top-0 h-[560px] hero-glow pointer-events-none" aria-hidden />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-white dark:to-[#0a0a0a]"
        aria-hidden
      />

      <header className="relative z-10 h-14 px-5 sm:px-8 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <OpenLenMark className="h-6 w-6 shrink-0" />
          <span className="font-semibold tracking-tight text-[14px]">
            Open<span className="text-coral-500 dark:text-coral-400">Len</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={toggleDark}
          aria-label={t("shell.toggleDarkMode")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-900 transition-colors"
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-5 sm:px-8 py-8">
        <div className="w-full max-w-[420px]">{children}</div>
      </main>

      <footer className="relative z-10 px-5 sm:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-zinc-400 dark:text-zinc-600">
        <div className="flex items-center gap-3">
          <span>© 2026 OpenLen</span>
          <span className="text-zinc-300 dark:text-zinc-800">·</span>
          <a
            href="https://www.gnu.org/licenses/agpl-3.0.html"
            target="_blank"
            rel="noreferrer"
            className="hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            AGPL-3.0
          </a>
          <span className="text-zinc-300 dark:text-zinc-800">·</span>
          <a
            href="https://github.com/jesusbernalrj/inari-pages"
            target="_blank"
            rel="noreferrer"
            className="hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            {t("shell.openSource")}
          </a>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/privacy" className="hover:text-zinc-700 dark:hover:text-zinc-300">
            {t("shell.privacy")}
          </Link>
          <span className="text-zinc-300 dark:text-zinc-800">·</span>
          <Link href="/terms" className="hover:text-zinc-700 dark:hover:text-zinc-300">
            {t("shell.terms")}
          </Link>
        </div>
      </footer>
    </div>
  );
}
