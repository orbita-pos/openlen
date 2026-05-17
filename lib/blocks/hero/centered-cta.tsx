/**
 * Source: Tailark (MIT) — hero-section-1 pattern
 *   https://github.com/tailark/blocks
 * License: MIT — see /LICENSES/tailark.MIT.txt
 * Adapted for OpenLen design tokens: hardcoded colours replaced with
 * `tokens.X`, copy lifted into the `slotsSchema`, mockup image moved to a
 * slot so the orchestrator's image step can populate it. No visual changes
 * beyond token substitution and slot extraction.
 */
import { z } from "zod";
import { EditableText } from "../_editable";
import type {
  BlockComponent,
  BlockComponentProps,
  BlockMeta,
} from "../types";

export const slotsSchema = z.object({
  eyebrow: z.string().max(40).optional(),
  headline: z.string().max(80),
  sub: z.string().max(180),
  primaryCTA: z.object({
    label: z.string().max(24),
    href: z.string(),
  }),
  secondaryCTA: z
    .object({
      label: z.string().max(24),
      href: z.string(),
    })
    .optional(),
  mockupSrc: z.string().optional(),
  mockupAlt: z.string().max(140).optional(),
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "hero/centered-cta",
  displayName: "Centered hero with CTA pair",
  description:
    "Eyebrow + display headline + supporting paragraph + primary/secondary CTA. Optional product mockup rendered below. Best when the product needs a confident, focal-point introduction.",
  aesthetics: ["technical-minimal", "refined-editorial"],
  slotsSchema,
  exampleSlots: {
    eyebrow: "New · v2.0",
    headline: "Tide — the inbox that closes itself.",
    sub: "Tide reads the room. It triages, drafts, and follows up so you spend mornings shipping, not sorting.",
    primaryCTA: { label: "Start free", href: "#start" },
    secondaryCTA: { label: "See it work", href: "#demo" },
    mockupSrc:
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1600&q=80",
    mockupAlt: "Tide inbox dashboard screenshot",
  },
};

export const Component: BlockComponent<typeof slotsSchema> = ({
  slots,
  tokens,
}: BlockComponentProps<typeof slotsSchema>) => {
  return (
    <section
      aria-labelledby="hero-centered-cta-headline"
      style={{
        background: tokens.bg,
        color: tokens.text,
        fontFamily: tokens.fontBody,
      }}
      className="relative w-full overflow-hidden"
    >
      <div className="mx-auto flex max-w-[1280px] flex-col items-center px-6 pt-24 pb-16 text-center sm:pt-32 sm:pb-24 lg:pt-40">
        {slots.eyebrow ? (
          <span
            className="mb-6 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium tracking-wider uppercase"
            style={{
              background: tokens.surfaceElevated,
              border: `1px solid ${tokens.border}`,
              color: tokens.textMuted,
            }}
          >
            <EditableText slot="eyebrow">{slots.eyebrow}</EditableText>
          </span>
        ) : null}

        <h1
          id="hero-centered-cta-headline"
          className="max-w-[840px] text-balance text-4xl leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl"
          style={{
            fontFamily: tokens.fontDisplay,
            letterSpacing: "-0.035em",
            fontWeight: 600,
          }}
        >
          <EditableText slot="headline">{slots.headline}</EditableText>
        </h1>

        <p
          className="mt-6 max-w-[640px] text-pretty text-base leading-relaxed sm:text-lg"
          style={{ color: tokens.textMuted }}
        >
          <EditableText slot="sub">{slots.sub}</EditableText>
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:gap-4">
          <a
            href={slots.primaryCTA.href}
            className="inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-medium transition-colors"
            style={{
              background: tokens.accent,
              color: tokens.accentFg,
              borderRadius: tokens.radius,
            }}
          >
            <EditableText slot="primaryCTA.label">{slots.primaryCTA.label}</EditableText>
          </a>
          {slots.secondaryCTA ? (
            <a
              href={slots.secondaryCTA.href}
              className="inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-medium transition-colors"
              style={{
                background: "transparent",
                color: tokens.text,
                border: `1px solid ${tokens.borderStrong}`,
                borderRadius: tokens.radius,
              }}
            >
              <EditableText slot="secondaryCTA.label">{slots.secondaryCTA.label}</EditableText>
            </a>
          ) : null}
        </div>

        {slots.mockupSrc ? (
          <div
            className="mt-16 w-full max-w-[1100px] overflow-hidden sm:mt-24"
            style={{
              borderRadius: tokens.radius,
              border: `1px solid ${tokens.border}`,
              boxShadow: tokens.shadow,
              background: tokens.surface,
            }}
          >
            <img
              src={slots.mockupSrc}
              alt={slots.mockupAlt ?? "Product preview"}
              className="block h-auto w-full"
              loading="lazy"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
};
