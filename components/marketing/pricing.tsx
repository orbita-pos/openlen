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
    suffix: "forever",
    blurb: "For tinkerers and side projects.",
    cta: { label: "Clone the repo", variant: "outline", icon: GithubIcon },
    features: [
      "Run the generator locally",
      "Unlimited self-hosted pages",
      "Bring your own LLM key (OpenAI, Anthropic, local)",
      "Community Discord",
    ],
  },
  {
    name: "Pro",
    featured: true,
    price: 19,
    suffix: "/month",
    blurb: "Hosted generator + premium image gen.",
    cta: { label: "Start Pro — 14 days free", variant: "primary", icon: Sparkles, href: "/register" },
    features: [
      "Everything in Free",
      "100 hosted generations / mo",
      "FLUX.2 HD images included",
      "1-click deploy to Vercel & Cloudflare",
      "Custom domains on hosted pages",
      "Priority email support",
    ],
  },
  {
    name: "Team",
    price: 49,
    suffix: "/month per seat",
    blurb: "For agencies and product teams.",
    cta: { label: "Talk to sales", variant: "outline", icon: ArrowRight },
    features: [
      "Everything in Pro",
      "Unlimited generations",
      "Shared brand kit & component library",
      "SSO + audit log",
      "Slack-shared support channel",
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
            Priced like a tool.{" "}
            <span className="text-zinc-500 dark:text-zinc-400">Not like a SaaS.</span>
          </h2>
          <p className="mt-4 text-zinc-500 dark:text-zinc-400">
            Generous free tier. The Pro plan is what a single Lovable invoice usually
            costs.
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
                    <span className="inline-flex items-center gap-1 rounded-full bg-coral-700 px-3 py-1 text-[11px] font-semibold text-white shadow-md">
                      <Sparkles size={11} /> Most popular
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
                  {t.name === "Free" && (
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

                {t.cta.href ? <Link href={t.cta.href}>{ctaButton}</Link> : ctaButton}

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
