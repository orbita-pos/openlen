/**
 * Source: Tailark (MIT) — features-1 pattern
 *   https://github.com/tailark/blocks
 * License: MIT — see /LICENSES/tailark.MIT.txt
 * Adapted: tokens substituted, icons routed through `_icons.tsx` so the AI
 * only emits enum string names rather than JSX.
 */
import { z } from "zod";
import { EditableText } from "../_editable";
import { getIcon } from "../_icons";
import { ICON_NAMES, type BlockComponent, type BlockComponentProps, type BlockMeta } from "../types";

export const slotsSchema = z.object({
  eyebrow: z.string().max(40).optional(),
  title: z.string().max(80),
  sub: z.string().max(200).optional(),
  items: z
    .array(
      z.object({
        icon: z.enum(ICON_NAMES),
        title: z.string().max(50),
        body: z.string().max(180),
      })
    )
    .min(3)
    .max(9),
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "features/icon-grid-3col",
  displayName: "3-column icon grid",
  description:
    "Grid of feature tiles, each with an icon, a short title, and a one-paragraph body. Use for foundational feature lists where parity between items matters.",
  aesthetics: [
    "technical-minimal",
    "refined-editorial",
    "warm-humanist",
    "editorial-maximalist",
    "brutalist-technical",
  ],
  slotsSchema,
  exampleSlots: {
    eyebrow: "What's inside",
    title: "Everything Tide does in the background.",
    sub: "Six surfaces, one inbox. Tide handles the small things so you can spend the morning on the work that ships.",
    items: [
      {
        icon: "zap",
        title: "Triage in the background",
        body: "Tide reads every message and decides what waits, what answers itself, and what needs you.",
      },
      {
        icon: "wand",
        title: "Drafts that sound like you",
        body: "Replies match your tone from past threads. Edit one line, send.",
      },
      {
        icon: "gauge",
        title: "Follow-ups, on their own",
        body: "Three days, no reply, gentle nudge. Two more nudges, then closed quietly.",
      },
      {
        icon: "lock",
        title: "Keys you control",
        body: "Local processing for sensitive threads. We never see them.",
      },
      {
        icon: "globe",
        title: "Multi-account, one rope",
        body: "Personal, work, side project. One queue, no context switch.",
      },
      {
        icon: "sparkles",
        title: "Quiet by design",
        body: "No notifications for noise. Only the threads worth interrupting your work.",
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
      aria-labelledby="features-icon-grid-headline"
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
              <EditableText slot="eyebrow">{slots.eyebrow}</EditableText>
            </span>
          ) : null}

          <h2
            id="features-icon-grid-headline"
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

        <ul
          role="list"
          className="mt-14 grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 lg:gap-y-14"
        >
          {slots.items.map((item, i) => {
            const Icon = getIcon(item.icon);
            return (
              <li key={i} className="flex flex-col items-start text-left">
                <div
                  className="mb-4 inline-flex h-10 w-10 items-center justify-center"
                  style={{
                    background: tokens.surfaceElevated,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: tokens.radius,
                    color: tokens.accent,
                  }}
                >
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                </div>
                <h3
                  className="text-lg font-medium leading-tight tracking-tight"
                  style={{
                    fontFamily: tokens.fontDisplay,
                    letterSpacing: "-0.01em",
                    color: tokens.text,
                  }}
                >
                  <EditableText slot={`items[${i}].title`}>{item.title}</EditableText>
                </h3>
                <p
                  className="mt-2 text-sm leading-relaxed"
                  style={{ color: tokens.textMuted }}
                >
                  <EditableText slot={`items[${i}].body`}>{item.body}</EditableText>
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
};
