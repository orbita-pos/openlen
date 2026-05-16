/**
 * Source: Tailark (MIT) — testimonials-2 pattern
 *   https://github.com/tailark/blocks
 * License: MIT — see /LICENSES/tailark.MIT.txt
 *
 * Adapted: tokens substituted; per-item `avatarColor` slot lets the AI pick
 * a hex tone for the avatar circle when no real avatar image is supplied
 * (production landing pages rarely have real photos for every quote).
 */
import { z } from "zod";
import type {
  BlockComponent,
  BlockComponentProps,
  BlockMeta,
} from "../types";

export const slotsSchema = z.object({
  eyebrow: z.string().max(40).optional(),
  title: z.string().max(80).optional(),
  items: z
    .array(
      z.object({
        quote: z.string().max(360),
        name: z.string().max(50),
        role: z.string().max(60),
        company: z.string().max(50),
        avatarColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      })
    )
    .min(3)
    .max(9),
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "testimonials/quote-grid-3col",
  displayName: "Quote grid (3 columns)",
  description:
    "Grid of customer quotes with name, role, company, and optional coloured initial avatar. Use for products where the social proof is the headline argument.",
  aesthetics: [
    "technical-minimal",
    "refined-editorial",
    "warm-humanist",
    "editorial-maximalist",
    "brutalist-technical",
  ],
  slotsSchema,
  exampleSlots: {
    eyebrow: "Customer stories",
    title: "From teams already shipping with Cohort.",
    items: [
      {
        quote:
          "We replaced three standup tools with Cohort in a week. Engineering ships 18% more sprints since. The async digest is so good my PMs have stopped DMing the eng leads.",
        name: "Maya Okonkwo",
        role: "Head of Engineering",
        company: "Ledgerly",
        avatarColor: "#6366F1",
      },
      {
        quote:
          "Cohort gets out of the way. The team writes their updates the way they actually talk. Nobody fills out a form. That's the whole pitch.",
        name: "Jonas Pedersen",
        role: "Staff Engineer",
        company: "Northwind Robotics",
        avatarColor: "#F97316",
      },
      {
        quote:
          "The retro module alone paid for the seat. Three quarters in we have shipped two product bets directly traceable to a Cohort thread.",
        name: "Aaliyah Mensah",
        role: "VP Product",
        company: "Quartile",
        avatarColor: "#10B981",
      },
    ],
  },
};

function avatarInitial(name: string) {
  return name.trim().charAt(0).toUpperCase();
}

export const Component: BlockComponent<typeof slotsSchema> = ({
  slots,
  tokens,
}: BlockComponentProps<typeof slotsSchema>) => {
  return (
    <section
      aria-labelledby={slots.title ? "testimonials-grid-headline" : undefined}
      style={{
        background: tokens.bg,
        color: tokens.text,
        fontFamily: tokens.fontBody,
      }}
      className="relative w-full"
    >
      <div className="mx-auto max-w-[1280px] px-6 py-20 sm:py-28 lg:py-32">
        {slots.title ? (
          <div className="mx-auto mb-14 max-w-[720px] text-center">
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
              id="testimonials-grid-headline"
              className="text-balance text-3xl leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl"
              style={{
                fontFamily: tokens.fontDisplay,
                letterSpacing: "-0.025em",
                fontWeight: 600,
              }}
            >
              {slots.title}
            </h2>
          </div>
        ) : null}

        <ul
          role="list"
          className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {slots.items.map((t, i) => (
            <li
              key={i}
              className="flex flex-col p-6"
              style={{
                background: tokens.surface,
                border: `1px solid ${tokens.border}`,
                borderRadius: tokens.radius,
              }}
            >
              <blockquote
                className="text-base leading-relaxed"
                style={{ color: tokens.text }}
              >
                <span aria-hidden="true">{"“"}</span>
                {t.quote}
                <span aria-hidden="true">{"”"}</span>
              </blockquote>
              <footer className="mt-5 flex items-center gap-3">
                <div
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center text-sm font-medium"
                  style={{
                    background: t.avatarColor ?? tokens.surfaceElevated,
                    color: t.avatarColor ? "#FFFFFF" : tokens.text,
                    borderRadius: "9999px",
                  }}
                >
                  {avatarInitial(t.name)}
                </div>
                <div className="min-w-0">
                  <div
                    className="truncate text-sm font-medium"
                    style={{ color: tokens.text }}
                  >
                    {t.name}
                  </div>
                  <div
                    className="truncate text-xs"
                    style={{ color: tokens.textDim }}
                  >
                    {t.role} · {t.company}
                  </div>
                </div>
              </footer>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};
