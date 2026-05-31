"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/cn";

// Switching keeps you on the same page: usePathname() (from @/i18n/navigation)
// returns the pathname WITHOUT the locale prefix, and router.replace(..., {
// locale }) re-prefixes it. We read the current query from window.location at
// change time instead of useSearchParams() so this can sit in the marketing
// nav without forcing a Suspense boundary / dynamic rendering on the homepage.
const NATIVE_NAMES: Record<string, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  ja: "日本語",
  ko: "한국어",
  zh: "中文",
  nl: "Nederlands",
};

export function LocaleSwitcher({ className }: { className?: string }) {
  const active = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common");
  const [pending, startTransition] = useTransition();

  function switchTo(locale: string) {
    if (locale === active || pending) return;
    const search = typeof window !== "undefined" ? window.location.search : "";
    const query = Object.fromEntries(new URLSearchParams(search));
    startTransition(() => {
      router.replace({ pathname, query }, { locale });
    });
  }

  return (
    <div className={cn("relative inline-flex items-center", pending && "opacity-50", className)}>
      <select
        aria-label={t("language")}
        value={active}
        disabled={pending}
        onChange={(e) => switchTo(e.target.value)}
        className={cn(
          "appearance-none rounded-md border border-zinc-200 dark:border-zinc-800",
          "bg-transparent py-1 pl-2 pr-6 text-[12px] font-semibold leading-none",
          "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100",
          "cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-400/40",
        )}
      >
        {routing.locales.map((locale) => (
          <option key={locale} value={locale}>
            {NATIVE_NAMES[locale] ?? locale.toUpperCase()}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        className="pointer-events-none absolute right-1.5 h-3 w-3 text-zinc-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
