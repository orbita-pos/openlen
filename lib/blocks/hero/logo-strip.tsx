/**
 * Source: Tailark (MIT) — hero-section-7 pattern
 *   https://github.com/tailark/blocks
 * Plus: Magic UI (MIT) — <Marquee> animation pattern
 *   https://github.com/magicuidesign/magicui
 * Licenses: MIT — see /LICENSES/tailark.MIT.txt and /LICENSES/magic-ui.MIT.txt
 *
 * Adapted: tokens substituted, marquee animation kept CSS-only (no
 * framer-motion dep), social proof copy lifted to slot.
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
  sub: z.string().max(200),
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
  logoProofText: z.string().max(120),
  logos: z
    .array(
      z.object({
        name: z.string().max(40),
        src: z.string().optional(),
      })
    )
    .min(3)
    .max(12),
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "hero/logo-strip",
  displayName: "Hero with customer logo strip",
  description:
    "Centered hero followed by a horizontal logo strip (marquee on small screens). Use when social proof is a major lever — established customers, household names.",
  aesthetics: ["technical-minimal", "refined-editorial"],
  slotsSchema,
  exampleSlots: {
    eyebrow: "Trusted by teams shipping at scale",
    headline: "Arrow — production data, observable.",
    sub: "Stream events, traces, and metrics into one queryable surface. Arrow keeps everything alive for 30 days; you keep the customer's trust.",
    primaryCTA: { label: "Get started", href: "#start" },
    secondaryCTA: { label: "View docs", href: "#docs" },
    logoProofText: "Trusted by the teams that ship to millions",
    logos: [
      { name: "Tide" },
      { name: "Folio" },
      { name: "Letter" },
      { name: "Cohort" },
      { name: "Daybreak" },
      { name: "Kettle" },
      { name: "Glass" },
      { name: "Brace" },
    ],
  },
};

const marqueeKeyframes = `@keyframes inari-marquee-strip{from{transform:translateX(0)}to{transform:translateX(-50%)}}`;

export const Component: BlockComponent<typeof slotsSchema> = ({
  slots,
  tokens,
}: BlockComponentProps<typeof slotsSchema>) => {
  const doubled = [...slots.logos, ...slots.logos];

  return (
    <section
      aria-labelledby="hero-logo-strip-headline"
      style={{
        background: tokens.bg,
        color: tokens.text,
        fontFamily: tokens.fontBody,
      }}
      className="relative w-full overflow-hidden"
    >
      <style dangerouslySetInnerHTML={{ __html: marqueeKeyframes }} />

      <div className="mx-auto flex max-w-[1280px] flex-col items-center px-6 pt-24 pb-12 text-center sm:pt-32 sm:pb-16 lg:pt-40">
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
          id="hero-logo-strip-headline"
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
            className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium"
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
              className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium"
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

      <div className="mx-auto max-w-[1280px] px-6 pb-20 sm:pb-28">
        <p
          className="mb-8 text-center text-xs font-medium tracking-wider uppercase"
          style={{ color: tokens.textDim }}
        >
          <EditableText slot="logoProofText">{slots.logoProofText}</EditableText>
        </p>

        <div
          aria-hidden="true"
          className="relative overflow-hidden"
          style={{
            maskImage:
              "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
          }}
        >
          <div
            className="flex w-max items-center gap-12"
            style={{
              animation: "inari-marquee-strip 40s linear infinite",
            }}
          >
            {doubled.map((logo, i) => (
              <div
                key={`${logo.name}-${i}`}
                className="flex h-10 shrink-0 items-center justify-center"
                style={{ color: tokens.textMuted, minWidth: "120px" }}
              >
                {logo.src ? (
                  <img
                    src={logo.src}
                    alt={logo.name}
                    className="block h-7 w-auto opacity-70"
                    loading="lazy"
                  />
                ) : (
                  <span
                    className="text-lg font-medium tracking-tight"
                    style={{ fontFamily: tokens.fontDisplay, letterSpacing: "-0.02em" }}
                  >
                    {logo.name}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
