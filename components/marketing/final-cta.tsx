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
        <div className="relative rounded-3xl bg-zinc-950 dark:bg-zinc-900 px-8 sm:px-16 py-20 overflow-hidden ring-1 ring-zinc-800">
          <div className="absolute inset-0 grid-bg opacity-[0.08]" aria-hidden />
          <div
            className="absolute -inset-x-20 -top-32 h-80 bg-[radial-gradient(50%_60%_at_50%_50%,rgba(255,90,54,0.45)_0%,rgba(255,90,54,0)_70%)]"
            aria-hidden
          />
          <div
            className="absolute bottom-0 right-0 w-[480px] h-[480px] bg-[radial-gradient(50%_60%_at_50%_50%,rgba(255,170,90,0.16)_0%,rgba(255,170,90,0)_70%)]"
            aria-hidden
          />

          <div className="relative max-w-3xl">
            <Badge
              tone="coral"
              className="!bg-coral-500/15 !text-coral-300 !ring-coral-500/30"
            >
              <Unlock size={11} /> {t("finalCta.badge")}
            </Badge>
            <h2 className="mt-5 text-4xl sm:text-6xl font-semibold tracking-tightest text-white leading-[1.02]">
              {t.rich("finalCta.title", {
                br: () => <br />,
                muted: (chunks) => <span className="text-zinc-500">{chunks}</span>,
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
                aria-label={t("finalCta.githubAria")}
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
