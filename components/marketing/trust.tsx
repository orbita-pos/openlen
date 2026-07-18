import { Activity, ArrowUpRight, FolderDown, Gauge, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { GithubIcon } from "@/components/ui/brand-icons";
import { getUptimeBadge, type UptimeBadge } from "@/lib/marketing/uptime";

/* Sección de confianza — cada sello lleva su botón de verificación. El
   uptime llega server-rendered del status worker (ISR); si el fetch cae,
   la card degrada a copy 24/7 sin número. Cero JS de cliente. */

const CELL =
  "group relative overflow-hidden rounded-3xl bg-white/70 dark:bg-white/[0.04] ring-1 ring-zinc-200/70 dark:ring-white/10 backdrop-blur-sm p-7 sm:p-8 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-coral-950/[0.07] dark:hover:shadow-black/30";

const STATUS_URL = "https://status.openlen.com";
const PSI_URL =
  "https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fheadwaters-demo.openlen.com%2F";
const REPO_URL = "https://github.com/orbita-pos/openlen";

function IconChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-coral-500/10 text-coral-500">
      {children}
    </span>
  );
}

function CardCta({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-coral-600 dark:text-coral-400 hover:underline underline-offset-4"
    >
      {children}
      <ArrowUpRight
        size={14}
        className="transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
      />
    </a>
  );
}

function StatusDot({ badge }: { badge: UptimeBadge | null }) {
  const color =
    badge === null ? "bg-zinc-400" : badge.up ? "bg-emerald-500" : "bg-amber-400";
  const glow =
    badge === null
      ? ""
      : badge.up
        ? "shadow-[0_0_10px] shadow-emerald-500/60"
        : "shadow-[0_0_10px] shadow-amber-400/60";
  return <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${color} ${glow}`} />;
}

export async function Trust() {
  const t = await getTranslations("marketing");
  const badge = await getUptimeBadge();

  return (
    <section id="confianza" className="relative scroll-mt-20">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <div className="max-w-2xl">
          <Badge tone="coral">
            <ShieldCheck size={11} /> {t("trust.badge")}
          </Badge>
          <h2 className="mt-4 text-3xl sm:text-5xl font-semibold tracking-tightest leading-[1.08]">
            {t.rich("trust.title", {
              muted: (chunks) => (
                <span className="serif-accent bg-gradient-to-br from-coral-500 via-coral-600 to-rose-500 bg-clip-text text-transparent pr-[0.04em]">
                  {chunks}
                </span>
              ),
            })}
          </h2>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">{t("trust.subtitle")}</p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className={CELL}>
            <div className="flex items-center justify-between">
              <IconChip>
                <Activity size={18} />
              </IconChip>
              <StatusDot badge={badge} />
            </div>
            <h3 className="mt-5 text-[15px] font-semibold tracking-tight">
              {t("trust.uptime.title")}
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {badge === null
                ? t("trust.uptime.fallback")
                : t.rich("trust.uptime.live", {
                    pct: badge.pct,
                    window:
                      badge.window === "d90"
                        ? t("trust.uptime.windows.d90")
                        : badge.window === "d7"
                          ? t("trust.uptime.windows.d7")
                          : t("trust.uptime.windows.d1"),
                    b: (chunks) => (
                      <strong className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                        {chunks}
                      </strong>
                    ),
                  })}
            </p>
            <CardCta href={STATUS_URL}>{t("trust.uptime.cta")}</CardCta>
          </div>

          <div className={CELL}>
            <IconChip>
              <Gauge size={18} />
            </IconChip>
            <h3 className="mt-5 text-[15px] font-semibold tracking-tight">
              {t("trust.speed.title")}
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {t("trust.speed.body")}
            </p>
            <CardCta href={PSI_URL}>{t("trust.speed.cta")}</CardCta>
          </div>

          <div className={CELL}>
            <IconChip>
              <FolderDown size={18} />
            </IconChip>
            <h3 className="mt-5 text-[15px] font-semibold tracking-tight">
              {t("trust.yours.title")}
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {t("trust.yours.body")}
            </p>
          </div>

          <div className={CELL}>
            <IconChip>
              <GithubIcon size={18} />
            </IconChip>
            <h3 className="mt-5 text-[15px] font-semibold tracking-tight">
              {t("trust.open.title")}
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {t("trust.open.body")}
            </p>
            <CardCta href={REPO_URL}>{t("trust.open.cta")}</CardCta>
          </div>
        </div>
      </div>
    </section>
  );
}
