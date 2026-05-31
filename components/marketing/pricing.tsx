import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  ArrowRight,
  Check,
  Sparkles,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { GithubIcon } from "@/components/ui/brand-icons";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type CtaIconComponent =
  | LucideIcon
  | ((props: { size?: number; className?: string }) => React.ReactElement);

interface Tier {
  name: string;
  featured?: boolean;
  comingSoon?: boolean;
  oss?: boolean;
  price: number;
  suffix: string;
  blurb: string;
  cta: { label: string; variant: ButtonVariant; icon: CtaIconComponent; href?: string };
  features: string[];
}

export async function Pricing() {
  const t = await getTranslations("marketing");

  const tiers: Tier[] = [
    {
      name: t("pricing.free.name"),
      price: 0,
      suffix: t("pricing.free.suffix"),
      blurb: t("pricing.free.blurb"),
      cta: { label: t("pricing.free.cta"), variant: "primary", icon: Sparkles, href: "/register" },
      features: [
        t("pricing.free.features.0"),
        t("pricing.free.features.1"),
        t("pricing.free.features.2"),
        t("pricing.free.features.3"),
        t("pricing.free.features.4"),
      ],
    },
    {
      name: t("pricing.pro.name"),
      featured: true,
      comingSoon: true,
      price: 19,
      suffix: t("pricing.pro.suffix"),
      blurb: t("pricing.pro.blurb"),
      cta: { label: t("pricing.pro.cta"), variant: "outline", icon: ArrowRight, href: "/register" },
      features: [
        t("pricing.pro.features.0"),
        t("pricing.pro.features.1"),
        t("pricing.pro.features.2"),
        t("pricing.pro.features.3"),
        t("pricing.pro.features.4"),
      ],
    },
    {
      name: t("pricing.selfHost.name"),
      oss: true,
      price: 0,
      suffix: t("pricing.selfHost.suffix"),
      blurb: t("pricing.selfHost.blurb"),
      cta: { label: t("pricing.selfHost.cta"), variant: "outline", icon: GithubIcon, href: "https://github.com/orbita-pos/openlen" },
      features: [
        t("pricing.selfHost.features.0"),
        t("pricing.selfHost.features.1"),
        t("pricing.selfHost.features.2"),
        t("pricing.selfHost.features.3"),
        t("pricing.selfHost.features.4"),
      ],
    },
  ];

  return (
    <section id="pricing" className="relative">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <div className="text-center max-w-2xl mx-auto">
          <Badge tone="zinc">
            <Wallet size={11} /> {t("pricing.badge")}
          </Badge>
          <h2 className="mt-4 text-3xl sm:text-5xl font-semibold tracking-tightest leading-[1.05]">
            {t.rich("pricing.title", {
              muted: (chunks) => (
                <span className="text-zinc-500 dark:text-zinc-400">{chunks}</span>
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
            return (
              <div
                key={tier.name}
                className={cn(
                  "relative rounded-2xl bg-white dark:bg-[#0a0a0a] p-7 sm:p-8 flex flex-col",
                  tier.featured
                    ? "ring-coral lg:scale-[1.02] lg:-my-2"
                    : "ring-1 ring-zinc-200 dark:ring-zinc-800",
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
                    <span className="text-[11px] uppercase tracking-wider text-zinc-400">
                      OSS
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{tier.blurb}</p>

                <div className="mt-6 flex items-end gap-1.5">
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
                    // share their accessible name with the other GitHub anchors
                    // on the page so screen readers don't read four different
                    // labels for the same destination.
                    <a
                      href={tier.cta.href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t("pricing.githubAria")}
                    >
                      {ctaButton}
                    </a>
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

        <div className="mt-10 text-center text-xs text-zinc-500 dark:text-zinc-400">
          {t("pricing.footnote")}
        </div>
      </div>
    </section>
  );
}
