/**
 * Source: Magic UI (MIT) — <AuroraText> + <HeroSection> patterns
 *   https://github.com/magicuidesign/magicui
 *   https://magicui.design/docs/components/aurora-text
 * License: MIT — see /LICENSES/magic-ui.MIT.txt
 * Adapted: gradient stops driven by tokens (accent + hover), copy lifted into
 * slots, animation kept (CSS-only background-position keyframes).
 *
 * NOTE: The headline supports an optional `accentWord` slot — that word (last
 * occurrence) is wrapped in an aurora gradient span. Falls back to plain text
 * if `accentWord` is omitted or not found.
 */
import { z } from "zod";
import type {
  BlockComponent,
  BlockComponentProps,
  BlockMeta,
} from "../types";

export const slotsSchema = z.object({
  eyebrow: z.string().max(40).optional(),
  headline: z.string().max(80),
  accentWord: z.string().max(24).optional(),
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
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "hero/animated-gradient",
  displayName: "Hero with animated aurora headline",
  description:
    "Centered hero with an animated gradient word in the headline. Best for editorial/maximalist briefs that want a focal visual moment without a product image.",
  aesthetics: ["editorial-maximalist", "warm-humanist"],
  slotsSchema,
  exampleSlots: {
    eyebrow: "Letter · est. 2026",
    headline: "Writing for the readers who actually finish.",
    accentWord: "finish",
    sub: "Letter is a publishing studio for long-form work. Editorial-grade typography, distraction-free reading, fair payouts. Built for the slow internet.",
    primaryCTA: { label: "Start writing", href: "#start" },
    secondaryCTA: { label: "Read a sample", href: "#read" },
  },
};

const auroraKeyframes = `@keyframes inari-aurora-shift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}`;

function splitHeadline(headline: string, accentWord?: string) {
  if (!accentWord) return { before: headline, accent: null, after: "" };
  const idx = headline.toLowerCase().lastIndexOf(accentWord.toLowerCase());
  if (idx < 0) return { before: headline, accent: null, after: "" };
  return {
    before: headline.slice(0, idx),
    accent: headline.slice(idx, idx + accentWord.length),
    after: headline.slice(idx + accentWord.length),
  };
}

export const Component: BlockComponent<typeof slotsSchema> = ({
  slots,
  tokens,
}: BlockComponentProps<typeof slotsSchema>) => {
  const { before, accent, after } = splitHeadline(slots.headline, slots.accentWord);
  const gradient = `linear-gradient(110deg, ${tokens.accent} 0%, ${tokens.accentHover} 45%, ${tokens.accent} 80%)`;

  return (
    <section
      aria-labelledby="hero-animated-gradient-headline"
      style={{
        background: tokens.bg,
        color: tokens.text,
        fontFamily: tokens.fontBody,
      }}
      className="relative w-full overflow-hidden"
    >
      <style dangerouslySetInnerHTML={{ __html: auroraKeyframes }} />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background: `radial-gradient(60% 50% at 50% 0%, ${tokens.accent}33 0%, transparent 60%)`,
        }}
      />

      <div className="relative mx-auto flex max-w-[1280px] flex-col items-center px-6 pt-28 pb-20 text-center sm:pt-36 sm:pb-28 lg:pt-44">
        {slots.eyebrow ? (
          <span
            className="mb-6 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium tracking-wider uppercase"
            style={{
              background: tokens.surfaceElevated,
              border: `1px solid ${tokens.border}`,
              color: tokens.textMuted,
            }}
          >
            {slots.eyebrow}
          </span>
        ) : null}

        <h1
          id="hero-animated-gradient-headline"
          className="max-w-[920px] text-balance text-4xl leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl"
          style={{
            fontFamily: tokens.fontDisplay,
            letterSpacing: "-0.035em",
            fontWeight: 600,
          }}
        >
          {before}
          {accent ? (
            <span
              style={{
                backgroundImage: gradient,
                backgroundSize: "200% 200%",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                animation: "inari-aurora-shift 6s ease-in-out infinite",
              }}
            >
              {accent}
            </span>
          ) : null}
          {after}
        </h1>

        <p
          className="mt-6 max-w-[640px] text-pretty text-base leading-relaxed sm:text-lg"
          style={{ color: tokens.textMuted }}
        >
          {slots.sub}
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
            {slots.primaryCTA.label}
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
              {slots.secondaryCTA.label}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
};
