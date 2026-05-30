"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/cn";

// Compact segmented EN | ES toggle. Switching keeps you on the same page —
// usePathname() (from @/i18n/navigation) returns the pathname WITHOUT the
// locale prefix, and router.replace(..., { locale }) re-prefixes it. We read
// the current query from window.location at click time instead of
// useSearchParams() so this can sit in the marketing nav without forcing a
// Suspense boundary / dynamic rendering on the static homepage.
const LABELS: Record<string, string> = { en: "EN", es: "ES" };

export function LocaleSwitcher({ className }: { className?: string }) {
  const active = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common");
  const [pending, startTransition] = useTransition();

  function switchTo(locale: string) {
    if (locale === active || pending) return;
    const search =
      typeof window !== "undefined" ? window.location.search : "";
    const query = Object.fromEntries(new URLSearchParams(search));
    startTransition(() => {
      router.replace({ pathname, query }, { locale });
    });
  }

  return (
    <div
      role="group"
      aria-label={t("language")}
      className={cn(
        "inline-flex items-center rounded-md border border-zinc-200 dark:border-zinc-800 p-0.5 transition-opacity",
        pending && "opacity-50",
        className,
      )}
    >
      {routing.locales.map((locale) => {
        const isActive = locale === active;
        return (
          <button
            key={locale}
            type="button"
            onClick={() => switchTo(locale)}
            aria-pressed={isActive}
            aria-label={locale === "es" ? t("switchToSpanish") : t("switchToEnglish")}
            disabled={pending}
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none transition-colors",
              isActive
                ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            {LABELS[locale] ?? locale.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
