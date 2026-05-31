import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Home } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages");
  return {
    title: t("notFound.metaTitle"),
    description: t("notFound.metaDescription"),
    robots: { index: false, follow: true },
  };
}

export default async function NotFound() {
  const t = await getTranslations("pages");
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-zinc-950">
      <MarketingChrome>
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 grid-bg opacity-40" aria-hidden />
          <div className="relative mx-auto max-w-2xl px-6 py-24 sm:py-32 text-center">
            <div className="inline-flex items-center gap-2 rounded-full ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white/70 dark:bg-zinc-950/70 backdrop-blur px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-coral-500 opacity-75 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-coral-500" />
              </span>
              {t("notFound.badge")}
            </div>

            <h1 className="mt-6 text-5xl sm:text-7xl font-semibold tracking-tightest leading-[0.95]">
              {t.rich("notFound.title", {
                accent: (chunks) => (
                  <span className="bg-gradient-to-br from-coral-500 to-coral-700 bg-clip-text text-transparent">
                    {chunks}
                  </span>
                ),
              })}
            </h1>

            <p className="mt-5 text-base sm:text-lg text-zinc-600 dark:text-zinc-400 max-w-md mx-auto">
              {t("notFound.lede")}
            </p>

            <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/"
                className="inline-flex items-center justify-center gap-1.5 rounded-full bg-coral-700 hover:bg-coral-800 active:bg-coral-900 btn-coral-shadow text-white px-5 py-2.5 text-sm font-medium transition"
              >
                <Home size={14} />
                {t("notFound.backHome")}
              </Link>
              <Link
                href="/templates"
                className="inline-flex items-center justify-center gap-1.5 rounded-full ring-1 ring-zinc-300 dark:ring-zinc-700 hover:ring-zinc-900 dark:hover:ring-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 transition"
              >
                {t("notFound.viewTemplates")}
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </section>
      </MarketingChrome>
    </div>
  );
}
