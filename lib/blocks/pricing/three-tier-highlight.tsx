/**
 * Source: Tailark (MIT) — pricing-2 pattern
 *   https://github.com/tailark/blocks
 * License: MIT — see /LICENSES/tailark.MIT.txt
 *
 * Adapted: tokens substituted, copy lifted to slots, the middle tier's
 * highlight is now driven by the `highlighted` boolean per-tier rather than
 * hardcoded. The `billingToggle` slot is purely visual — submit handler is
 * the orchestrator's job in compose.
 */
import { z } from "zod";
import { Check } from "lucide-react";
import type {
  BlockComponent,
  BlockComponentProps,
  BlockMeta,
} from "../types";

const tierSchema = z.object({
  name: z.string().max(30),
  price: z.string().max(20),
  period: z.string().max(20),
  blurb: z.string().max(140),
  features: z.array(z.string().max(80)).min(2).max(10),
  cta: z.object({
    label: z.string().max(24),
    href: z.string(),
  }),
  highlighted: z.boolean().optional(),
});

export const slotsSchema = z.object({
  eyebrow: z.string().max(40).optional(),
  title: z.string().max(80),
  sub: z.string().max(200).optional(),
  billingToggle: z.boolean().optional(),
  tiers: z.array(tierSchema).length(3),
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "pricing/three-tier-highlight",
  displayName: "Three-tier pricing with middle highlight",
  description:
    "Three pricing tiers in a row, with a configurable highlighted tier (typically the middle). Best for products with a clear good/better/best ladder.",
  aesthetics: [
    "technical-minimal",
    "refined-editorial",
    "warm-humanist",
    "editorial-maximalist",
    "brutalist-technical",
  ],
  slotsSchema,
  exampleSlots: {
    eyebrow: "Pricing",
    title: "Pay for the work, not the seats.",
    sub: "Every plan includes unlimited projects, real-time previews, and the full Tide model line. No per-seat fees.",
    billingToggle: false,
    tiers: [
      {
        name: "Starter",
        price: "$0",
        period: "free forever",
        blurb: "For solo founders shipping their first page.",
        features: [
          "5 pages / month",
          "All five palettes",
          "Quality gates on every output",
          "Community support",
        ],
        cta: { label: "Start free", href: "#start" },
      },
      {
        name: "Pro",
        price: "$19",
        period: "per month",
        blurb: "For teams that ship weekly.",
        features: [
          "Unlimited pages",
          "A/B race variants (3 at a time)",
          "OpenLen domain hosting",
          "Priority generation queue",
          "Email support, 24h response",
        ],
        cta: { label: "Try Pro for 14 days", href: "#pro" },
        highlighted: true,
      },
      {
        name: "Studio",
        price: "$49",
        period: "per month",
        blurb: "For agencies running client work.",
        features: [
          "Everything in Pro",
          "Claude Sonnet escalation on demand",
          "White-label PDF exports",
          "5 team seats included",
          "Slack support channel",
        ],
        cta: { label: "Contact sales", href: "#contact" },
      },
    ],
  },
};

export const Component: BlockComponent<typeof slotsSchema> = ({
  slots,
  tokens,
}: BlockComponentProps<typeof slotsSchema>) => {
  return (
    <section
      aria-labelledby="pricing-three-tier-headline"
      style={{
        background: tokens.bg,
        color: tokens.text,
        fontFamily: tokens.fontBody,
      }}
      className="relative w-full"
    >
      <div className="mx-auto max-w-[1280px] px-6 py-20 sm:py-28 lg:py-32">
        <div className="mx-auto max-w-[720px] text-center">
          {slots.eyebrow ? (
            <span
              className="mb-5 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium tracking-wider uppercase"
              style={{
                background: tokens.surfaceElevated,
                border: `1px solid ${tokens.border}`,
                color: tokens.textMuted,
              }}
            >
              {slots.eyebrow}
            </span>
          ) : null}
          <h2
            id="pricing-three-tier-headline"
            className="text-balance text-3xl leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl"
            style={{
              fontFamily: tokens.fontDisplay,
              letterSpacing: "-0.025em",
              fontWeight: 600,
            }}
          >
            {slots.title}
          </h2>
          {slots.sub ? (
            <p
              className="mt-5 text-pretty text-base leading-relaxed sm:text-lg"
              style={{ color: tokens.textMuted }}
            >
              {slots.sub}
            </p>
          ) : null}

          {slots.billingToggle ? (
            <div
              role="group"
              aria-label="Billing period"
              className="mx-auto mt-8 inline-flex items-center p-1 text-sm"
              style={{
                background: tokens.surfaceElevated,
                border: `1px solid ${tokens.border}`,
                borderRadius: tokens.radius,
              }}
            >
              <span
                className="px-4 py-1.5 font-medium"
                style={{
                  background: tokens.accent,
                  color: tokens.accentFg,
                  borderRadius: tokens.radius,
                }}
              >
                Monthly
              </span>
              <span
                className="px-4 py-1.5"
                style={{ color: tokens.textMuted }}
              >
                Yearly (20% off)
              </span>
            </div>
          ) : null}
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-6">
          {slots.tiers.map((tier, i) => {
            const highlighted = tier.highlighted === true;
            return (
              <article
                key={i}
                className="flex flex-col p-7"
                style={{
                  background: highlighted ? tokens.surfaceElevated : tokens.surface,
                  border: `1px solid ${highlighted ? tokens.accent : tokens.border}`,
                  borderRadius: tokens.radius,
                  boxShadow: highlighted ? tokens.shadow : "none",
                }}
              >
                <header>
                  <h3
                    className="text-lg font-medium tracking-tight"
                    style={{
                      fontFamily: tokens.fontDisplay,
                      letterSpacing: "-0.01em",
                      color: tokens.text,
                    }}
                  >
                    {tier.name}
                  </h3>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span
                      className="text-4xl font-medium tracking-tight"
                      style={{
                        fontFamily: tokens.fontDisplay,
                        letterSpacing: "-0.025em",
                        color: tokens.text,
                      }}
                    >
                      {tier.price}
                    </span>
                    <span
                      className="text-sm"
                      style={{ color: tokens.textDim }}
                    >
                      {tier.period}
                    </span>
                  </div>
                  <p
                    className="mt-3 text-sm leading-relaxed"
                    style={{ color: tokens.textMuted }}
                  >
                    {tier.blurb}
                  </p>
                </header>

                <ul role="list" className="mt-6 space-y-2.5">
                  {tier.features.map((f, j) => (
                    <li
                      key={j}
                      className="flex gap-2.5 text-sm leading-relaxed"
                      style={{ color: tokens.text }}
                    >
                      <Check
                        size={16}
                        strokeWidth={2.25}
                        aria-hidden="true"
                        style={{ color: tokens.accent, marginTop: "2px", flexShrink: 0 }}
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <a
                  href={tier.cta.href}
                  className="mt-8 inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium"
                  style={{
                    background: highlighted ? tokens.accent : "transparent",
                    color: highlighted ? tokens.accentFg : tokens.text,
                    border: `1px solid ${highlighted ? tokens.accent : tokens.borderStrong}`,
                    borderRadius: tokens.radius,
                  }}
                >
                  {tier.cta.label}
                </a>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};
