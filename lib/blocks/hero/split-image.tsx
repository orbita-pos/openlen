/**
 * Source: Tailark (MIT) — hero-section-3 pattern
 *   https://github.com/tailark/blocks
 * License: MIT — see /LICENSES/tailark.MIT.txt
 * Adapted: tokens substituted, copy replaced by slots, image moved to slot.
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
  // Optional so the block can render a centered, image-less variant when the
  // caller opted out of AI imagery (and hasn't uploaded a replacement yet).
  imageSrc: z.string().optional(),
  imageAlt: z.string().max(140).optional(),
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "hero/split-image",
  displayName: "Split hero with product image",
  description:
    "60/40 split — copy on the left, product image on the right. Use when the product is visually distinctive and the image carries weight alongside the headline.",
  aesthetics: [
    "technical-minimal",
    "refined-editorial",
    "warm-humanist",
    "editorial-maximalist",
  ],
  slotsSchema,
  exampleSlots: {
    eyebrow: "Daybreak · for teams that ship",
    headline: "Morning standup, without the standup.",
    sub: "Daybreak collects the right context overnight and lands it in your channel by 9 AM. Your team reads, replies, gets on with the work.",
    primaryCTA: { label: "Try it free", href: "#start" },
    secondaryCTA: { label: "How it works", href: "#how" },
    imageSrc:
      "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=1400&q=80",
    imageAlt: "Daybreak morning standup digest delivered to a team channel",
  },
};

export const Component: BlockComponent<typeof slotsSchema> = ({
  slots,
  tokens,
}: BlockComponentProps<typeof slotsSchema>) => {
  // Image presence drives the whole layout: with one we keep the 60/40 split;
  // without we re-center the copy and widen it so the section reads like a
  // centered hero. Avoids a half-empty right column when AI imagery is off.
  const hasImage =
    typeof slots.imageSrc === "string" && slots.imageSrc.length > 0;

  return (
    <section
      aria-labelledby="hero-split-image-headline"
      style={{
        background: tokens.bg,
        color: tokens.text,
        fontFamily: tokens.fontBody,
      }}
      className="relative w-full overflow-hidden"
    >
      <div
        className={
          hasImage
            ? "mx-auto grid max-w-[1280px] grid-cols-1 items-center gap-10 px-6 py-20 sm:py-28 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:py-36"
            : "mx-auto flex max-w-[840px] flex-col items-center px-6 py-24 text-center sm:py-32 lg:py-40"
        }
      >
        <div
          className={
            hasImage
              ? "flex flex-col items-start text-left"
              : "flex flex-col items-center text-center"
          }
        >
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
            id="hero-split-image-headline"
            className="text-balance text-4xl leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl"
            style={{
              fontFamily: tokens.fontDisplay,
              letterSpacing: "-0.03em",
              fontWeight: 600,
            }}
          >
            <EditableText slot="headline">{slots.headline}</EditableText>
          </h1>

          <p
            className="mt-6 max-w-[560px] text-pretty text-base leading-relaxed sm:text-lg"
            style={{ color: tokens.textMuted }}
          >
            <EditableText slot="sub">{slots.sub}</EditableText>
          </p>

          <div
            className={
              hasImage
                ? "mt-9 flex flex-col gap-3 sm:flex-row sm:gap-4"
                : "mt-9 flex flex-col gap-3 sm:flex-row sm:gap-4 justify-center"
            }
          >
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

        {hasImage ? (
          <div
            className="relative overflow-hidden"
            style={{
              borderRadius: tokens.radius,
              border: `1px solid ${tokens.border}`,
              boxShadow: tokens.shadow,
              background: tokens.surface,
            }}
          >
            <img
              src={slots.imageSrc}
              alt={slots.imageAlt ?? ""}
              className="block h-auto w-full"
              loading="lazy"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
};
