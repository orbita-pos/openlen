import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { countLiveProjects } from "@/lib/projects";
import { countTemplates } from "@/lib/templates/store";
import { HeroProduct } from "./hero-product";

export async function Hero() {
  const t = await getTranslations("marketing");
  // Real numbers only: the live-pages chip hides itself at 0 instead of
  // rendering a sad empty brag.
  const [pagesLive, templateCount] = await Promise.all([
    countLiveProjects().catch(() => 0),
    countTemplates().catch(() => 0),
  ]);

  return (
    <section className="relative overflow-hidden">
      <div className="relative mx-auto max-w-7xl px-6 pt-16 sm:pt-24">
        <div className="flex flex-col items-center text-center">
          <Link
            href="/templates"
            className="group inline-flex items-center gap-2 rounded-full bg-white/70 dark:bg-white/[0.06] backdrop-blur ring-1 ring-white/80 dark:ring-white/10 px-3 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 shadow-sm hover:ring-coral-300/70 dark:hover:ring-coral-400/30 transition"
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-coral-500/10 text-coral-700 dark:text-coral-300 px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
              {t("hero.alphaBadge")}
            </span>
            {t("hero.alphaPitch", { count: templateCount })}
            <ArrowRight
              size={12}
              className="opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-100"
            />
          </Link>

          <h1 className="mt-8 max-w-5xl text-pretty text-5xl sm:text-6xl md:text-7xl lg:text-[86px] font-semibold tracking-tightest leading-[1.02]">
            {t.rich("hero.title", {
              br: () => <br />,
              muted: (chunks) => (
                <span className="text-zinc-400 dark:text-zinc-500 font-medium">{chunks}</span>
              ),
              gradient: (chunks) => (
                <span className="serif-accent bg-gradient-to-br from-coral-500 via-coral-600 to-rose-500 bg-clip-text text-transparent pr-[0.06em]">
                  {chunks}
                </span>
              ),
            })}
          </h1>

          <p className="mt-7 max-w-xl text-pretty text-lg text-zinc-600 dark:text-zinc-400">
            {t.rich("hero.subtitle", {
              count: templateCount,
              strong: (chunks) => (
                <span className="text-zinc-900 dark:text-zinc-100 font-medium">
                  {chunks}
                </span>
              ),
            })}
          </p>

          {pagesLive > 0 && (
            <div className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-white/70 dark:bg-white/[0.06] backdrop-blur ring-1 ring-white/80 dark:ring-white/10 px-4 py-1.5 text-[13px] text-zinc-600 dark:text-zinc-300 shadow-sm">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {t.rich("hero.pagesLive", {
                count: pagesLive,
                strong: (chunks) => (
                  <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {chunks}
                  </span>
                ),
              })}
            </div>
          )}

        </div>
      </div>

      {/* Product mock — wider than the copy column, anchored below it so its top
          peeks into the fold (Framer/Linear style) and bleeds off the bottom. */}
      <div className="relative mx-auto max-w-[88rem] px-6 mt-12 pb-20 sm:mt-16 sm:pb-24">
        {/* Dawn bloom under the mock — soft coral→rose→violet halo. */}
        <div
          className="absolute -inset-x-4 -top-8 bottom-10 rounded-[48px] bg-gradient-to-r from-coral-400/25 via-rose-300/20 to-violet-300/25 dark:from-coral-500/15 dark:via-rose-400/10 dark:to-violet-400/15 blur-3xl"
          aria-hidden
        />
        <div className="relative">
          <HeroProduct />
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-white dark:to-[#0a0a0a]"
        aria-hidden
      />
    </section>
  );
}
