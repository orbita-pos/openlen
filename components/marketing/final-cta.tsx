import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Check, Sparkles, Unlock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/ui/brand-icons";

export async function FinalCta() {
  const t = await getTranslations("marketing");
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-6 py-24">
        {/* Dusk card — the page opens at dawn (hero aurora) and closes here at
            nightfall: warm violet twilight, faint stars, coral horizon. */}
        <div className="relative rounded-[2.5rem] bg-[linear-gradient(180deg,#3a2a55_0%,#241a3e_42%,#161028_100%)] px-8 sm:px-16 py-20 overflow-hidden ring-1 ring-white/10">
          <div className="absolute inset-0 stars-dusk opacity-80" aria-hidden />
          <div
            className="absolute -inset-x-20 -top-32 h-80 bg-[radial-gradient(50%_60%_at_50%_50%,rgba(255,110,64,0.4)_0%,rgba(255,110,64,0)_70%)]"
            aria-hidden
          />
          <div
            className="absolute inset-x-0 bottom-0 h-56 bg-[radial-gradient(60%_140px_at_50%_100%,rgba(238,148,205,0.22)_0%,transparent_70%)]"
            aria-hidden
          />

          <div className="relative max-w-3xl">
            <Badge
              tone="coral"
              className="!bg-coral-500/15 !text-coral-300 !ring-coral-500/30"
            >
              <Unlock size={11} /> {t("finalCta.badge")}
            </Badge>
            <h2 className="mt-5 text-4xl sm:text-6xl font-semibold tracking-tightest text-white leading-[1.06]">
              {t.rich("finalCta.title", {
                br: () => <br />,
                muted: (chunks) => (
                  <span className="serif-accent text-rose-200/95 pr-[0.04em]">{chunks}</span>
                ),
              })}
            </h2>
            <p className="mt-6 text-lg text-zinc-300 max-w-xl">
              {t.rich("finalCta.subtitle", {
                strong: (chunks) => (
                  <span className="text-white font-medium">{chunks}</span>
                ),
              })}
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <Link href="/register">
                <Button size="lg" className="!h-12 !px-6 text-[15px]">
                  <Sparkles size={16} /> {t("finalCta.generateBtn")}
                </Button>
              </Link>
              <a
                href="https://github.com/orbita-pos/openlen"
                target="_blank"
                rel="noreferrer"
              >
                <Button
                  variant="outline"
                  size="lg"
                  className="!h-12 !px-6 text-[15px] !bg-transparent !text-white !ring-zinc-700 hover:!bg-zinc-900"
                >
                  <GithubIcon size={16} /> {t("finalCta.cloneBtn")}
                </Button>
              </a>
            </div>
            <div className="mt-5 text-xs text-zinc-500 flex flex-wrap items-center gap-4">
              <span className="flex items-center gap-1.5">
                <Check size={12} className="text-emerald-400" /> {t("finalCta.perks.noCard")}
              </span>
              <span className="flex items-center gap-1.5">
                <Check size={12} className="text-emerald-400" /> {t("finalCta.perks.agpl")}
              </span>
              <span className="hidden sm:flex items-center gap-1.5">
                <Check size={12} className="text-emerald-400" /> {t("finalCta.perks.selfHost")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
