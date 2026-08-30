"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, Globe } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { useGenerationBusy } from "@/lib/generation-busy";
import { cn } from "@/lib/cn";

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

// Custom popover language picker (replaces the native <select>). Switching keeps
// you on the same page: usePathname() (from @/i18n/navigation) returns the
// pathname WITHOUT the locale prefix, and router.replace(..., { locale })
// re-prefixes it. The current query is read from window.location at click time
// instead of useSearchParams() so this can sit in the marketing nav without
// forcing a Suspense boundary / dynamic rendering on the static homepage.
export function LocaleSwitcher({
  className,
  compact = false,
}: {
  className?: string;
  /** Debajo de `lg`, deja sólo el globo y el chevron — el nombre del idioma se
   *  esconde. OPT-IN a propósito: en la barra del taller ese nombre medía
   *  100px, MÁS QUE EL BOTÓN DE DEPLOY, y era el 26% de una barra de 390px
   *  mientras el nombre del proyecto se quedaba en 32px. En la nav de
   *  marketing o en el dashboard no hay esa competencia, así que allí el
   *  nombre se lee entero y no se toca. El globo sigue diciendo qué es, y el
   *  desplegable sigue llevando el nombre nativo completo. */
  compact?: boolean;
}) {
  const active = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // While an AI generation is in flight on /new, switching locale would
  // navigate + remount the workspace and drop the page being built — so the
  // switcher disables itself until it finishes.
  const busy = useGenerationBusy();

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function switchTo(locale: string) {
    setOpen(false);
    if (locale === active || pending || busy) return;
    const search = typeof window !== "undefined" ? window.location.search : "";
    const query = Object.fromEntries(new URLSearchParams(search));
    startTransition(() => {
      router.replace({ pathname, query }, { locale });
    });
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending || busy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("language")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5",
          "text-[13px] font-medium leading-none transition-colors",
          "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
          "dark:text-zinc-300 dark:hover:bg-zinc-800/70 dark:hover:text-white",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-coral-500/40",
          open && "bg-zinc-100 text-zinc-900 dark:bg-zinc-800/70 dark:text-white",
          (pending || busy) && "opacity-60",
          busy && "cursor-not-allowed",
        )}
      >
        <Globe size={14} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
        <span className={cn(compact && "hidden lg:inline")}>
          {NATIVE_NAMES[active] ?? active.toUpperCase()}
        </span>
        <ChevronDown
          size={13}
          className={cn(
            "shrink-0 text-zinc-400 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t("language")}
          className={cn(
            "absolute right-0 z-50 mt-2 max-h-72 w-44 overflow-y-auto p-1",
            "rounded-xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/10 ring-1 ring-black/[0.04]",
            "dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/40 dark:ring-white/5",
            "origin-top-right animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150",
          )}
        >
          {routing.locales.map((locale) => {
            const isActive = locale === active;
            return (
              <button
                key={locale}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => switchTo(locale)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] leading-none transition-colors",
                  isActive
                    ? "bg-coral-50 font-semibold text-coral-700 dark:bg-coral-500/10 dark:text-coral-300"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                )}
              >
                <span className="flex items-center gap-2.5">
                  <span className="w-5 shrink-0 font-mono text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    {locale}
                  </span>
                  <span>{NATIVE_NAMES[locale] ?? locale.toUpperCase()}</span>
                </span>
                {isActive && (
                  <Check size={14} className="shrink-0 text-coral-600 dark:text-coral-400" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
