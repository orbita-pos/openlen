/**
 * Source: Tailark (MIT) — call-to-action-1 pattern
 *   https://github.com/tailark/blocks
 * License: MIT — see /LICENSES/tailark.MIT.txt
 *
 * Adapted: gradient driven by accent + accentHover tokens; copy lifted to
 * slots; padding kept generous so this block can either close the page or
 * separate two content sections.
 */
import { z } from "zod";
import { EditableText } from "../_editable";
import type {
  BlockComponent,
  BlockComponentProps,
  BlockMeta,
} from "../types";

export const slotsSchema = z.object({
  title: z.string().max(90),
  sub: z.string().max(220).optional(),
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
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "cta/gradient-cta",
  displayName: "Full-width gradient CTA",
  description:
    "Centred call-to-action panel with a soft accent-gradient backdrop. Use to close the page or punctuate between major sections.",
  aesthetics: [
    "technical-minimal",
    "refined-editorial",
    "warm-humanist",
    "editorial-maximalist",
    "brutalist-technical",
  ],
  slotsSchema,
  exampleSlots: {
    title: "Start your first page in under a minute.",
    sub: "No credit card. No install. Type a brief, watch the page come together, ship it to your domain.",
    primaryCTA: { label: "Start free", href: "#start" },
    secondaryCTA: { label: "Talk to us", href: "#contact" },
  },
};

export const Component: BlockComponent<typeof slotsSchema> = ({
  slots,
  tokens,
}: BlockComponentProps<typeof slotsSchema>) => {
  return (
    <section
      aria-labelledby="cta-gradient-headline"
      style={{
        background: tokens.bg,
        color: tokens.text,
        fontFamily: tokens.fontBody,
      }}
      className="relative w-full"
    >
      <div className="mx-auto max-w-[1280px] px-6 py-16 sm:py-20 lg:py-24">
        <div
          className="relative overflow-hidden px-8 py-14 text-center sm:px-12 sm:py-20 lg:px-20 lg:py-24"
          style={{
            borderRadius: tokens.radius,
            border: `1px solid ${tokens.border}`,
            background: `radial-gradient(120% 80% at 50% 0%, ${tokens.accent}33 0%, ${tokens.surface} 60%)`,
          }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background: `radial-gradient(60% 50% at 50% 100%, ${tokens.accentHover}22 0%, transparent 65%)`,
            }}
          />

          <h2
            id="cta-gradient-headline"
            className="relative mx-auto max-w-[720px] text-balance text-3xl leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl"
            style={{
              fontFamily: tokens.fontDisplay,
              letterSpacing: "-0.03em",
              fontWeight: 600,
              color: tokens.text,
            }}
          >
            <EditableText slot="title">{slots.title}</EditableText>
          </h2>

          {slots.sub ? (
            <p
              className="relative mx-auto mt-5 max-w-[560px] text-pretty text-base leading-relaxed sm:text-lg"
              style={{ color: tokens.textMuted }}
            >
              <EditableText slot="sub">{slots.sub}</EditableText>
            </p>
          ) : null}

          <div className="relative mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <a
              href={slots.primaryCTA.href}
              className="inline-flex items-center justify-center px-6 py-3 text-sm font-medium"
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
                className="inline-flex items-center justify-center px-6 py-3 text-sm font-medium"
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
        </div>
      </div>
    </section>
  );
};
