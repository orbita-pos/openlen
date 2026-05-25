import Link from "next/link";
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
  price: number;
  suffix: string;
  blurb: string;
  cta: { label: string; variant: ButtonVariant; icon: CtaIconComponent; href?: string };
  features: string[];
}

const tiers: Tier[] = [
  {
    name: "Free",
    price: 0,
    suffix: "during alpha",
    blurb: "Everything works. No paywall during the alpha.",
    cta: { label: "Try it free", variant: "primary", icon: Sparkles, href: "/register" },
    features: [
      "Generate from a prompt (Gemini 2.5 Pro)",
      "165 templates including 30 link-in-bio",
      "Publish to <you>.openlen.com",
      "Privacy-first analytics + per-link click tracking",
      "Lead forms with email notifications",
    ],
  },
  {
    name: "Pro",
    featured: true,
    comingSoon: true,
    price: 19,
    suffix: "/month",
    blurb: "Higher generation limits + custom domains.",
    cta: { label: "Get notified at launch", variant: "outline", icon: ArrowRight, href: "/register" },
    features: [
      "Everything in Free",
      "1,000 AI generations / month",
      "Custom domains (links.your-brand.com)",
      "Analytics retention beyond 90 days",
      "Priority email support",
    ],
  },
  {
    name: "Self-host",
    price: 0,
    suffix: "forever",
    blurb: "Run the whole stack on your own box.",
    cta: { label: "Clone the repo", variant: "outline", icon: GithubIcon, href: "https://github.com/jesusbernalrj/inari-pages" },
    features: [
      "AGPLv3 — yours to modify + redistribute",
      "Bring your own Gemini / Kimi API key",
      "Single Hetzner box runs everything",
      "Wildcard subdomain via nginx",
      "No bill, no rate limit, no oversight",
    ],
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="relative">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <div className="text-center max-w-2xl mx-auto">
          <Badge tone="zinc">
            <Wallet size={11} /> Pricing
          </Badge>
          <h2 className="mt-4 text-3xl sm:text-5xl font-semibold tracking-tightest leading-[1.05]">
            Free during alpha.{" "}
            <span className="text-zinc-500 dark:text-zinc-400">Self-host forever.</span>
          </h2>
          <p className="mt-4 text-zinc-500 dark:text-zinc-400">
            No paywall while we&apos;re shipping v1 — every feature is open
            for testing. Pro tier with custom domains + higher limits is in
            the works.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-5">
          {tiers.map((t) => {
            const CtaIcon = t.cta.icon;
            const ctaButton = (
              <Button variant={t.cta.variant} size="lg" className="mt-6 w-full">
                <CtaIcon size={15} /> {t.cta.label}
              </Button>
            );
            return (
              <div
                key={t.name}
                className={cn(
                  "relative rounded-2xl bg-white dark:bg-[#0a0a0a] p-7 sm:p-8 flex flex-col",
                  t.featured
                    ? "ring-coral lg:scale-[1.02] lg:-my-2"
                    : "ring-1 ring-zinc-200 dark:ring-zinc-800",
                )}
              >
                {t.featured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900 dark:bg-zinc-200 px-3 py-1 text-[11px] font-semibold text-white dark:text-zinc-900 shadow-md">
                      {t.comingSoon ? "Coming soon" : (<><Sparkles size={11} /> Most popular</>)}
                    </span>
                  </div>
                )}
                <div className="flex items-baseline justify-between">
                  <h3
                    className={cn(
                      "text-lg font-semibold",
                      t.featured && "text-coral-700 dark:text-coral-300",
                    )}
                  >
                    {t.name}
                  </h3>
                  {t.name === "Self-host" && (
                    <span className="text-[11px] uppercase tracking-wider text-zinc-400">
                      OSS
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t.blurb}</p>

                <div className="mt-6 flex items-end gap-1.5">
                  <span className="text-5xl font-semibold tracking-tightest tabular-nums">
                    ${t.price}
                  </span>
                  <span className="text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">
                    {t.suffix}
                  </span>
                </div>

                {t.cta.href ? (
                  <Link
                    href={t.cta.href}
                    // External repo links (Self-host tier) share their
                    // accessible name with the other GitHub anchors on
                    // the page so screen readers don't read four
                    // different labels for the same destination.
                    aria-label={
                      t.cta.href.startsWith("https://github.com/")
                        ? "OpenLen on GitHub"
                        : undefined
                    }
                  >
                    {ctaButton}
                  </Link>
                ) : (
                  ctaButton
                )}

                <div className="mt-7 border-t border-zinc-100 dark:border-zinc-900 pt-6">
                  <ul className="space-y-3">
                    {t.features.map((f, fi) => (
                      <li key={fi} className="flex items-start gap-2.5 text-sm">
                        <Check
                          size={14}
                          strokeWidth={2.5}
                          className={cn(
                            "mt-0.5 shrink-0",
                            t.featured ? "text-coral-500" : "text-emerald-500",
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
          All plans include the open-source generator under AGPL. Hosted plans add
          convenience, not features.
        </div>
      </div>
    </section>
  );
}
