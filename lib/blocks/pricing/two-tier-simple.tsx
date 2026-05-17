/**
 * Source: shadcn/ui (MIT) — pricing block reference
 *   https://github.com/shadcn-ui/ui
 * Plus: HyperUI (MIT) — two-tier comparison layout
 *   https://github.com/markmead/hyperui
 * Licenses: MIT — see /LICENSES/shadcn-ui.MIT.txt and /LICENSES/hyperui.MIT.txt
 *
 * Adapted: tokens substituted, slots schema enforces exactly two tiers so the
 * AI can't drift to three (which would just become three-tier-highlight).
 */
import { z } from "zod";
import { EditableText } from "../_editable";
import { Check } from "../_icons";
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
  features: z.array(z.string().max(80)).min(2).max(8),
  cta: z.object({
    label: z.string().max(24),
    href: z.string(),
  }),
  highlighted: z.boolean().optional(),
});

export const slotsSchema = z.object({
  title: z.string().max(80),
  sub: z.string().max(200).optional(),
  tiers: z.tuple([tierSchema, tierSchema]),
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "pricing/two-tier-simple",
  displayName: "Two-tier pricing (free vs paid)",
  description:
    "Two tiers, side-by-side, with one optionally highlighted. Use when the product has a clear free / paid split and a third tier would only confuse.",
  aesthetics: ["technical-minimal", "warm-humanist"],
  slotsSchema,
  exampleSlots: {
    title: "Pick the version that fits.",
    sub: "Free forever for hobby projects. Pro when the writing starts to pay you back.",
    tiers: [
      {
        name: "Free",
        price: "$0",
        period: "forever",
        blurb: "Everything you need to publish.",
        features: [
          "Unlimited posts",
          "Custom subdomain",
          "Reader analytics",
          "Markdown export",
        ],
        cta: { label: "Start writing", href: "#start" },
      },
      {
        name: "Pro",
        price: "$8",
        period: "per month",
        blurb: "For writers building an audience.",
        features: [
          "Everything in Free",
          "Custom domain",
          "Email subscriptions + paid tiers",
          "Inari Watch monitoring",
          "Priority support",
        ],
        cta: { label: "Go Pro", href: "#pro" },
        highlighted: true,
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
      aria-labelledby="pricing-two-tier-headline"
      style={{
        background: tokens.bg,
        color: tokens.text,
        fontFamily: tokens.fontBody,
      }}
      className="relative w-full"
    >
      <div className="mx-auto max-w-[1280px] px-6 py-20 sm:py-28 lg:py-32">
        <div className="mx-auto max-w-[720px] text-center">
          <h2
            id="pricing-two-tier-headline"
            className="text-balance text-3xl leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl"
            style={{
              fontFamily: tokens.fontDisplay,
              letterSpacing: "-0.025em",
              fontWeight: 600,
            }}
          >
            <EditableText slot="title">{slots.title}</EditableText>
          </h2>
          {slots.sub ? (
            <p
              className="mt-5 text-pretty text-base leading-relaxed sm:text-lg"
              style={{ color: tokens.textMuted }}
            >
              <EditableText slot="sub">{slots.sub}</EditableText>
            </p>
          ) : null}
        </div>

        <div className="mx-auto mt-14 grid max-w-[920px] grid-cols-1 gap-6 md:grid-cols-2">
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
                    <EditableText slot={`tiers[${i}].name`}>{tier.name}</EditableText>
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
                      <EditableText slot={`tiers[${i}].price`}>{tier.price}</EditableText>
                    </span>
                    <span className="text-sm" style={{ color: tokens.textDim }}>
                      <EditableText slot={`tiers[${i}].period`}>{tier.period}</EditableText>
                    </span>
                  </div>
                  <p
                    className="mt-3 text-sm leading-relaxed"
                    style={{ color: tokens.textMuted }}
                  >
                    <EditableText slot={`tiers[${i}].blurb`}>{tier.blurb}</EditableText>
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
                      <span>
                        <EditableText slot={`tiers[${i}].features[${j}]`}>{f}</EditableText>
                      </span>
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
                  <EditableText slot={`tiers[${i}].cta.label`}>{tier.cta.label}</EditableText>
                </a>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};
