import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  ArrowRight,
  Check,
  Mail,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { GithubIcon } from "@/components/ui/brand-icons";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { countTemplates } from "@/lib/templates/store";
import {
  MAX_CREDITS,
  MAX_PRICE,
  PRO_CREDITS,
  PRO_PRICE,
  PRO_SAVE_PERCENT,
  PRO_WAS,
  centsPerCredit,
} from "@/lib/marketing/plan-price";
import { LenSays } from "./len-says";

type CtaIconComponent =
  | LucideIcon
  | ((props: { size?: number; className?: string }) => React.ReactElement);

interface Tier {
  name: string;
  featured?: boolean;
  comingSoon?: boolean;
  oss?: boolean;
  price: number;
  /** El precio anterior, tachado. Sólo donde hay uno de verdad. */
  wasPrice?: number;
  /** La etiqueta del descuento, ya traducida. */
  discount?: string;
  suffix: string;
  blurb: string;
  cta: { label: string; variant: ButtonVariant; icon: CtaIconComponent; href?: string };
  features: string[];
}

export async function Pricing() {
  const t = await getTranslations("marketing");
  const locale = await getLocale();
  const templateCount = await countTemplates().catch(() => 0);

  // TRES PLANES Y EL SELF-HOST APARTE (04/10). Gratis, Pro $10 y Max $20 son
  // la misma cosa —Len trabajando para ti— con más o menos créditos; el
  // self-host es otra decisión (correrlo tú) y baja a una tira bajo las
  // tarjetas, al lado del trabajo a medida.
  const tiers: Tier[] = [
    {
      name: t("pricing.free.name"),
      price: 0,
      suffix: t("pricing.free.suffix"),
      blurb: t("pricing.free.blurb"),
      cta: { label: t("pricing.free.cta"), variant: "outline", icon: Sparkles, href: "/register" },
      features: [
        t("pricing.free.features.0"),
        t("pricing.free.features.1", { count: templateCount }),
        t("pricing.free.features.2"),
        t("pricing.free.features.3"),
        t("pricing.free.features.4"),
      ],
    },
    {
      name: t("pricing.pro.name"),
      featured: true,
      price: PRO_PRICE,
      wasPrice: PRO_WAS ?? undefined,
      discount: PRO_WAS === null ? undefined : t("pricing.pro.save", { percent: PRO_SAVE_PERCENT }),
      suffix: t("pricing.pro.suffix"),
      blurb: t("pricing.pro.blurb"),
      cta: { label: t("pricing.pro.cta"), variant: "primary", icon: ArrowRight, href: `/api/billing/checkout?locale=${locale}` },
      features: [
        t("pricing.pro.features.0"),
        t("pricing.pro.features.1", { credits: PRO_CREDITS }),
        t("pricing.pro.features.2"),
        t("pricing.pro.features.3"),
        t("pricing.pro.features.4"),
      ],
    },
    {
      name: t("pricing.max.name"),
      price: MAX_PRICE,
      suffix: t("pricing.max.suffix"),
      blurb: t("pricing.max.blurb"),
      // ⚠️ `plan=max` no lo lee nadie todavía: /api/billing/checkout vende el
      // único producto que conoce. Ver lib/marketing/plan-price.ts.
      cta: { label: t("pricing.max.cta"), variant: "outline", icon: ArrowRight, href: `/api/billing/checkout?plan=max&locale=${locale}` },
      features: [
        t("pricing.max.features.0"),
        t("pricing.max.features.1", { credits: MAX_CREDITS, times: MAX_CREDITS / PRO_CREDITS }),
        t("pricing.max.features.2", {
          cents: centsPerCredit(MAX_PRICE, MAX_CREDITS),
          proCents: centsPerCredit(PRO_PRICE, PRO_CREDITS),
        }),
      ],
    },
  ];

  return (
    <section id="pricing" data-len-section="precios" className="relative scroll-mt-20">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <div className="text-center max-w-2xl mx-auto">
          <LenSays className="justify-center">{t("pricing.lenSays")}</LenSays>
          <h2 className="mt-6 text-3xl sm:text-5xl font-semibold tracking-tightest leading-[1.08]">
            {t.rich("pricing.title", {
              price: PRO_PRICE,
              muted: (chunks) => (
                <span className="font-medium text-zinc-500 dark:text-zinc-400">
                  {chunks}
                </span>
              ),
            })}
          </h2>
          <p className="mt-4 text-zinc-500 dark:text-zinc-400">
            {t("pricing.subtitle")}
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-5">
          {tiers.map((tier) => {
            const CtaIcon = tier.cta.icon;
            const ctaButton = (
              <Button variant={tier.cta.variant} size="lg" className="mt-6 w-full">
                <CtaIcon size={15} /> {tier.cta.label}
              </Button>
            );
            const isExternalCta = tier.cta.href?.startsWith("https://");
            // /api/* (Pro → Polar checkout): plain same-tab <a>. NOT next-intl
            // Link (it prefixes the locale → /en/api/... → 404), and NOT
            // target=_blank — it's a same-origin redirect to the hosted checkout.
            const isRawCta = tier.cta.href?.startsWith("/api/");
            return (
              <div
                key={tier.name}
                className={cn(
                  "relative rounded-3xl bg-white/80 dark:bg-white/[0.04] backdrop-blur-sm p-7 sm:p-8 flex flex-col transition-shadow duration-300 hover:shadow-xl hover:shadow-coral-950/[0.06] dark:hover:shadow-black/30",
                  tier.featured
                    ? "ring-coral lg:scale-[1.02] lg:-my-2 shadow-lg shadow-coral-500/10"
                    : "ring-1 ring-zinc-200/70 dark:ring-white/10",
                )}
              >
                {tier.featured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900 dark:bg-zinc-200 px-3 py-1 text-[11px] font-semibold text-white dark:text-zinc-900 shadow-md">
                      {tier.comingSoon ? t("pricing.comingSoon") : (<><Sparkles size={11} /> {t("pricing.mostPopular")}</>)}
                    </span>
                  </div>
                )}
                <div className="flex items-baseline justify-between">
                  <h3
                    className={cn(
                      "text-lg font-semibold",
                      tier.featured && "text-coral-700 dark:text-coral-300",
                    )}
                  >
                    {tier.name}
                  </h3>
                  {tier.oss && (
                    <span className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      OSS
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{tier.blurb}</p>

                {(tier.wasPrice != null || tier.discount) && (
                  <div className="mt-6 flex flex-wrap items-center gap-2">
                    {tier.wasPrice != null && (
                      // aria-hidden: para quien escucha, el precio viejo sólo
                      // añade un número que confunde. La etiqueta ya dice todo.
                      <span
                        aria-hidden
                        className="text-lg font-medium tabular-nums text-zinc-400 line-through decoration-coral-500/70 decoration-2 dark:text-zinc-500"
                      >
                        ${tier.wasPrice}
                      </span>
                    )}
                    {tier.discount && (
                      <Badge tone="coral" className="font-semibold">{tier.discount}</Badge>
                    )}
                  </div>
                )}

                <div
                  className={cn(
                    "flex items-end gap-1.5",
                    tier.wasPrice != null || tier.discount ? "mt-1.5" : "mt-6",
                  )}
                >
                  <span className="text-5xl font-semibold tracking-tightest tabular-nums">
                    ${tier.price}
                  </span>
                  <span className="text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">
                    {tier.suffix}
                  </span>
                </div>

                {tier.cta.href ? (
                  isExternalCta ? (
                    // External repo links (Self-host tier) stay plain <a> and
                    <a
                      href={tier.cta.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {ctaButton}
                    </a>
                  ) : isRawCta ? (
                    <a href={tier.cta.href}>{ctaButton}</a>
                  ) : (
                    <Link href={tier.cta.href}>{ctaButton}</Link>
                  )
                ) : (
                  ctaButton
                )}

                <div className="mt-7 border-t border-zinc-100 dark:border-zinc-900 pt-6">
                  <ul className="space-y-3">
                    {tier.features.map((f, fi) => (
                      <li key={fi} className="flex items-start gap-2.5 text-sm">
                        <Check
                          size={14}
                          strokeWidth={2.5}
                          className={cn(
                            "mt-0.5 shrink-0",
                            tier.featured ? "text-coral-500" : "text-emerald-500",
                          )}
                        />
                        <span className="text-zinc-700 dark:text-zinc-300">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>

        {/* Debajo de los planes, dos tiras: correrlo tú (self-host, gratis y
            para siempre) y el trabajo a medida, que no tiene precio fijo. */}
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="flex flex-col justify-between gap-5 rounded-3xl bg-white/70 dark:bg-white/[0.04] ring-1 ring-zinc-200/70 dark:ring-white/10 backdrop-blur-sm px-7 py-6">
            <div>
              <h3 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
                {t("pricing.selfHost.title")}
                <span className="text-[11px] font-normal uppercase tracking-wider text-zinc-500 dark:text-zinc-400">OSS</span>
              </h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {t("pricing.selfHost.body")}
              </p>
            </div>
            <a
              href="https://github.com/orbita-pos/openlen"
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-2 rounded-full ring-1 ring-zinc-300 dark:ring-zinc-700 px-4 py-2 text-[13.5px] font-medium transition-transform hover:-translate-y-0.5"
            >
              <GithubIcon size={14} />
              {t("pricing.selfHost.cta")}
            </a>
          </div>
          <div className="flex flex-col justify-between gap-5 rounded-3xl bg-white/70 dark:bg-white/[0.04] ring-1 ring-zinc-200/70 dark:ring-white/10 backdrop-blur-sm px-7 py-6">
            <div>
              <h3 className="text-[17px] font-semibold tracking-tight">{t("pricing.custom.title")}</h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {t("pricing.custom.body")}
              </p>
            </div>
            <a
              href="mailto:info@jesusbr.com"
              className="inline-flex w-fit items-center gap-2 rounded-full bg-zinc-900 dark:bg-white px-4 py-2 text-[13.5px] font-medium text-white dark:text-zinc-900 shadow-sm transition-transform hover:-translate-y-0.5"
            >
              <Mail size={14} />
              info@jesusbr.com
            </a>
          </div>
        </div>

        <div className="mt-10 text-center text-xs text-zinc-500 dark:text-zinc-400">
          {t("pricing.footnote")}
        </div>
      </div>
    </section>
  );
}
