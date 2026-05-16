/**
 * Source: Magic UI (MIT) — <BentoGrid> pattern
 *   https://github.com/magicuidesign/magicui
 *   https://magicui.design/docs/components/bento-grid
 * License: MIT — see /LICENSES/magic-ui.MIT.txt
 *
 * Adapted: tokens substituted; tile visual variants kept enum-driven (the AI
 * picks 'code' / 'stats' / 'image' / none, never JSX). The "visual" slot is
 * purely decorative — the orchestrator can layer in real images later via
 * `imageSrc` once image generation lands.
 */
import { z } from "zod";
import type {
  BlockComponent,
  BlockComponentProps,
  BlockMeta,
} from "../types";

const TILE_SIZE = ["large", "medium", "small"] as const;
const TILE_VISUAL = ["code", "stats", "image", "none"] as const;

export const slotsSchema = z.object({
  eyebrow: z.string().max(40).optional(),
  title: z.string().max(80),
  sub: z.string().max(200).optional(),
  tiles: z
    .array(
      z.object({
        size: z.enum(TILE_SIZE),
        title: z.string().max(60),
        body: z.string().max(200),
        visual: z.enum(TILE_VISUAL).optional(),
        imageSrc: z.string().optional(),
        imageAlt: z.string().max(140).optional(),
      })
    )
    .min(4)
    .max(7),
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "features/bento-asymmetric",
  displayName: "Asymmetric bento grid",
  description:
    "Asymmetric grid of feature tiles — one large tile anchors, smaller tiles fill around it. Use when you want hierarchy across features (one hero capability + supporting ones).",
  aesthetics: ["technical-minimal", "editorial-maximalist"],
  slotsSchema,
  exampleSlots: {
    eyebrow: "Why teams switch",
    title: "Built for the way you actually work.",
    sub: "Glass replaces the three tools you patched together. One canvas, end-to-end.",
    tiles: [
      {
        size: "large",
        title: "End-to-end planning, one canvas",
        body: "Roadmap, sprint, and changelog live in the same view. No swivel-chair between four tools.",
        visual: "image",
      },
      {
        size: "medium",
        title: "Sub-second search",
        body: "Local index, encrypted at rest. Find any ticket from the last two years in under 300ms.",
        visual: "code",
      },
      {
        size: "medium",
        title: "Real numbers, real time",
        body: "Velocity, cycle time, WIP. Live updates, no SQL needed.",
        visual: "stats",
      },
      {
        size: "small",
        title: "API-first",
        body: "Everything you see is REST + webhooks.",
      },
      {
        size: "small",
        title: "Imports in 90 seconds",
        body: "Jira, Linear, GitHub — bring everything.",
      },
    ],
  },
};

function VisualBackdrop({
  visual,
  tokens,
  imageSrc,
  imageAlt,
}: {
  visual: (typeof TILE_VISUAL)[number] | undefined;
  tokens: BlockComponentProps<typeof slotsSchema>["tokens"];
  imageSrc?: string;
  imageAlt?: string;
}) {
  if (visual === "image" && imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={imageAlt ?? ""}
        className="block h-40 w-full object-cover"
        loading="lazy"
      />
    );
  }
  if (visual === "code") {
    return (
      <div
        className="px-5 pt-4"
        style={{ fontFamily: tokens.fontMono, color: tokens.textMuted }}
      >
        <div className="text-xs leading-relaxed">
          {/* Keywords & strings use `text` (high contrast against any surface)
              with weight differences for visual hierarchy. The brand `accent`
              is reserved for buttons / solid-fill surfaces where its WCAG
              contrast holds — using it as inline text on `surfaceElevated`
              fails AA in dark palettes (#5E6AD2 → 3.66:1 on #1A1B1F). */}
          <span style={{ color: tokens.text, fontWeight: 600 }}>const</span> result =
          <br />
          &nbsp;&nbsp;await search(<span style={{ color: tokens.text }}>{`"latency"`}</span>);
          <br />
          <span style={{ color: tokens.textDim }}>→ 247 matches · 184ms</span>
        </div>
      </div>
    );
  }
  if (visual === "stats") {
    return (
      <div className="px-5 pt-4">
        <div
          className="text-3xl font-medium tracking-tight"
          style={{ fontFamily: tokens.fontDisplay, color: tokens.text }}
        >
          4.7d
        </div>
        <div className="text-xs" style={{ color: tokens.textDim }}>
          median cycle time · ↓ 38% vs last quarter
        </div>
      </div>
    );
  }
  return null;
}

function tileSpan(size: (typeof TILE_SIZE)[number]) {
  switch (size) {
    case "large":
      return "lg:col-span-2 lg:row-span-2";
    case "medium":
      return "lg:col-span-2";
    case "small":
    default:
      return "lg:col-span-1";
  }
}

export const Component: BlockComponent<typeof slotsSchema> = ({
  slots,
  tokens,
}: BlockComponentProps<typeof slotsSchema>) => {
  return (
    <section
      aria-labelledby="features-bento-headline"
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
            id="features-bento-headline"
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
        </div>

        <div className="mt-14 grid auto-rows-[minmax(220px,auto)] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          {slots.tiles.map((tile, i) => (
            <article
              key={i}
              className={`flex flex-col overflow-hidden ${tileSpan(tile.size)}`}
              style={{
                background: tokens.surface,
                border: `1px solid ${tokens.border}`,
                borderRadius: tokens.radius,
              }}
            >
              <VisualBackdrop
                visual={tile.visual}
                tokens={tokens}
                imageSrc={tile.imageSrc}
                imageAlt={tile.imageAlt}
              />
              <div className="flex flex-1 flex-col p-5">
                <h3
                  className="text-lg font-medium leading-tight tracking-tight"
                  style={{
                    fontFamily: tokens.fontDisplay,
                    letterSpacing: "-0.01em",
                    color: tokens.text,
                  }}
                >
                  {tile.title}
                </h3>
                <p
                  className="mt-2 text-sm leading-relaxed"
                  style={{ color: tokens.textMuted }}
                >
                  {tile.body}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};
