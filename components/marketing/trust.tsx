import { ArrowUpRight, FolderDown, Gauge, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { GithubIcon } from "@/components/ui/brand-icons";
import { getUptimeBadge, type UptimeBadge } from "@/lib/marketing/uptime";

/* Sección de confianza — un instrumento, no un folleto. El uptime vivo es el
   héroe (número gigante con el sensor dentro del aro de la lente, eco del
   status page al que apunta su botón); los demás sellos son filas de
   verificación tipo acta. Server-rendered vía ISR; si el fetch del status
   cae, el instrumento degrada al copy 24/7. Cero JS de cliente. */

const STATUS_URL = "https://status.openlen.com";
const PSI_URL =
  "https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fheadwaters-demo.openlen.com%2F";
const REPO_URL = "https://github.com/orbita-pos/openlen";

const PANEL =
  "relative overflow-hidden rounded-3xl bg-white/70 dark:bg-white/[0.04] ring-1 ring-zinc-200/70 dark:ring-white/10 backdrop-blur-sm";

/* El aro de la lente (gradiente del logo) con el sensor de estado al centro —
   la misma metáfora que abre status.openlen.com, para que el click aterrice
   en un lugar que se siente pariente. */
function LensSensor({ badge }: { badge: UptimeBadge | null }) {
  const dot =
    badge === null ? "bg-zinc-400" : badge.up ? "bg-emerald-500" : "bg-amber-400";
  return (
    <span className="relative inline-flex h-16 w-16 items-center justify-center" aria-hidden>
      <svg viewBox="0 0 64 64" fill="none" className="h-16 w-16">
        <defs>
          <linearGradient id="trust-lens" x1="14" y1="11" x2="52" y2="55" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF7E55" />
            <stop offset="0.52" stopColor="#FF5A36" />
            <stop offset="1" stopColor="#E5391A" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="22" stroke="url(#trust-lens)" strokeWidth="7" />
      </svg>
      <span className={`absolute h-3.5 w-3.5 rounded-full ${dot}`}>
        {badge?.up && (
          <span className="absolute inset-0 rounded-full bg-emerald-500 opacity-75 animate-ping motion-reduce:animate-none" />
        )}
      </span>
    </span>
  );
}

function RowCta({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="group/cta inline-flex shrink-0 items-center gap-1 text-sm font-medium text-coral-600 dark:text-coral-400 hover:underline underline-offset-4 sm:self-center"
    >
      {children}
      <ArrowUpRight
        size={14}
        className="transition group-hover/cta:translate-x-0.5 group-hover/cta:-translate-y-0.5"
      />
    </a>
  );
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

        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* ── El instrumento: uptime vivo ── */}
          <div className={`${PANEL} lg:col-span-5 p-8 sm:p-10 flex flex-col`}>
            {/* Amanecer del home, contenido en el panel. */}
            <div
              aria-hidden
              className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gradient-to-br from-coral-400/25 via-rose-300/20 to-violet-300/25 dark:from-coral-500/15 dark:via-rose-400/10 dark:to-violet-400/15 blur-3xl"
            />
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                {t("trust.uptime.title")}
              </p>
              <LensSensor badge={badge} />
            </div>

            <div className="mt-2 flex-1">
              {badge === null ? (
                <p className="text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {t("trust.uptime.fallback")}
                </p>
              ) : (
                <p className="text-base text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {t.rich("trust.uptime.live", {
                    pct: badge.pct,
                    window:
                      badge.window === "d90"
                        ? t("trust.uptime.windows.d90")
                        : badge.window === "d7"
                          ? t("trust.uptime.windows.d7")
                          : t("trust.uptime.windows.d1"),
                    b: (chunks) => (
                      <strong className="block text-6xl sm:text-7xl font-semibold tabular-nums tracking-tighter text-zinc-900 dark:text-zinc-100 mb-3">
                        {chunks}
                      </strong>
                    ),
                  })}
                </p>
              )}
            </div>

            <a
              href={STATUS_URL}
              target="_blank"
              rel="noopener"
              className="group/cta mt-8 inline-flex w-fit items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {t("trust.uptime.cta")}
              <ArrowUpRight
                size={14}
                className="transition group-hover/cta:translate-x-0.5 group-hover/cta:-translate-y-0.5"
              />
            </a>
          </div>

          {/* ── El acta: tres verificaciones en filas ── */}
          <div className={`${PANEL} lg:col-span-7 divide-y divide-zinc-200/70 dark:divide-white/10 px-7 sm:px-9`}>
            <div className="flex flex-col gap-3 py-7 sm:flex-row sm:items-center sm:gap-6">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-coral-500/10 text-coral-500">
                <Gauge size={19} />
              </span>
              <div className="flex-1">
                <h3 className="text-[15px] font-semibold tracking-tight">
                  {t("trust.speed.title")}
                </h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {t("trust.speed.body")}
                </p>
              </div>
              <RowCta href={PSI_URL}>{t("trust.speed.cta")}</RowCta>
            </div>

            <div className="flex flex-col gap-3 py-7 sm:flex-row sm:items-center sm:gap-6">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-coral-500/10 text-coral-500">
                <FolderDown size={19} />
              </span>
              <div className="flex-1">
                <h3 className="text-[15px] font-semibold tracking-tight">
                  {t("trust.yours.title")}
                </h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {t("trust.yours.body")}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5 sm:self-center" aria-hidden>
                {["ZIP", "GitHub", "Vercel"].map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 ring-1 ring-zinc-200/80 dark:ring-white/10 bg-white/60 dark:bg-white/[0.03]"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 py-7 sm:flex-row sm:items-center sm:gap-6">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-coral-500/10 text-coral-500">
                <GithubIcon size={19} />
              </span>
              <div className="flex-1">
                <h3 className="text-[15px] font-semibold tracking-tight">
                  {t("trust.open.title")}
                </h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {t("trust.open.body")}
                </p>
              </div>
              <RowCta href={REPO_URL}>{t("trust.open.cta")}</RowCta>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
