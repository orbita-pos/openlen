"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ArrowRight, Menu, Moon, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/cn";
import { OpenLenMark } from "@/components/openlen-logo";
import { LocaleSwitcher } from "@/components/locale-switcher";

const links = [
  { labelKey: "nav.links.templates", href: "/templates" },
  { labelKey: "nav.links.features", href: "/#features" },
  { labelKey: "nav.links.pricing", href: "/#pricing" },
  { labelKey: "nav.links.docs", href: "/docs" },
] as const;

export interface NavProps {
  dark: boolean;
  onToggleDark: () => void;
}

export function Nav({ dark, onToggleDark }: NavProps) {
  const t = useTranslations("marketing");
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-3 z-50 w-full px-3">
      {/* Floating glass pill — stays in normal flow so every MarketingChrome
          page keeps its top spacing. */}
      <div
        className={cn(
          "mx-auto flex w-fit max-w-full items-center gap-1 rounded-full border pl-4 pr-2 h-14 backdrop-blur-xl transition-all duration-300",
          scrolled || menuOpen
            ? "bg-white/85 border-zinc-200/80 shadow-lg shadow-coral-950/[0.07] dark:bg-zinc-950/85 dark:border-white/10 dark:shadow-black/30"
            : "bg-white/60 border-white/70 shadow-md shadow-coral-950/[0.05] dark:bg-white/[0.06] dark:border-white/10",
        )}
      >
        <Link
          href="/"
          onClick={() => setMenuOpen(false)}
          className="flex items-center gap-2 group mr-2"
        >
          <OpenLenMark className="h-6 w-6 shrink-0" />
          <span className="font-semibold tracking-tight text-[15px]">
            Open<span className="text-coral-700 dark:text-coral-400">Len</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center text-sm">
          {links.map((l) => (
            <Link
              key={l.labelKey}
              href={l.href}
              className="px-3 py-1.5 rounded-full text-[13.5px] text-zinc-600 hover:text-zinc-900 hover:bg-zinc-900/[0.04] dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-white/[0.06] transition-colors"
            >
              {t(l.labelKey)}
            </Link>
          ))}
          <a
            href="https://github.com/orbita-pos/openlen"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13.5px] text-zinc-600 hover:text-zinc-900 hover:bg-zinc-900/[0.04] dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <GithubIcon size={14} />
            <span>GitHub</span>
          </a>
        </nav>

        <div
          className="hidden md:block mx-1.5 h-5 w-px bg-zinc-900/10 dark:bg-white/10"
          aria-hidden
        />

        <div className="flex items-center gap-1">
          <LocaleSwitcher />
          <button
            type="button"
            onClick={onToggleDark}
            aria-label={t("nav.toggleDark")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 hover:text-zinc-900 hover:bg-zinc-900/[0.04] dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <Link
            href="/login"
            className="hidden sm:inline-flex items-center h-9 px-3 rounded-full text-[13px] font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.04] dark:hover:bg-white/[0.06] transition-colors"
          >
            {t("nav.signIn")}
          </Link>
          <Link href="/register" className="hidden sm:inline-flex">
            <Button size="sm" className="rounded-full">
              {t("nav.tryFree")} <ArrowRight size={14} />
            </Button>
          </Link>
          {/* Mobile menu toggle — the desktop nav and (on the smallest screens)
              the auth CTAs are hidden, so without this a phone visitor can't
              reach the links or sign up. */}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={t("nav.menu")}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-panel"
            className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 hover:text-zinc-900 hover:bg-zinc-900/[0.04] dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="mobile-nav-panel"
          className="md:hidden mx-auto mt-2 w-full max-w-sm rounded-3xl border border-zinc-200/80 dark:border-white/10 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl shadow-xl shadow-coral-950/[0.08] dark:shadow-black/40 px-4 py-3 flex flex-col gap-0.5"
        >
          {links.map((l) => (
            <Link
              key={l.labelKey}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              className="px-3 py-2.5 rounded-xl text-[15px] text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:text-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            >
              {t(l.labelKey)}
            </Link>
          ))}
          <a
            href="https://github.com/orbita-pos/openlen"
            target="_blank"
            rel="noreferrer"
            onClick={() => setMenuOpen(false)}
            className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-[15px] text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:text-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            <GithubIcon size={16} />
            <span>GitHub</span>
          </a>
          <div className="my-1.5 h-px bg-zinc-200/80 dark:bg-zinc-800/80" />
          <Link
            href="/login"
            onClick={() => setMenuOpen(false)}
            className="px-3 py-2.5 rounded-xl text-[15px] font-medium text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:text-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            {t("nav.signIn")}
          </Link>
          <Link
            href="/register"
            onClick={() => setMenuOpen(false)}
            className="mt-1"
          >
            <Button size="sm" className="w-full rounded-full">
              {t("nav.tryFree")} <ArrowRight size={14} />
            </Button>
          </Link>
        </nav>
      )}
    </header>
  );
}
