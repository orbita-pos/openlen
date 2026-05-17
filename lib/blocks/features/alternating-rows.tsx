/**
 * Source: Tailark (MIT) — features-7 pattern
 *   https://github.com/tailark/blocks
 * License: MIT — see /LICENSES/tailark.MIT.txt
 * Adapted: tokens substituted, copy + images lifted to slot array.
 */
import { z } from "zod";
import { EditableText } from "../_editable";
import type {
  BlockComponent,
  BlockComponentProps,
  BlockMeta,
} from "../types";

const IMAGE_POSITION = ["left", "right"] as const;

export const slotsSchema = z.object({
  eyebrow: z.string().max(40).optional(),
  title: z.string().max(80).optional(),
  rows: z
    .array(
      z.object({
        title: z.string().max(70),
        body: z.string().max(260),
        bullets: z.array(z.string().max(120)).max(4).optional(),
        imagePosition: z.enum(IMAGE_POSITION),
        // Optional so the block can render text-only rows when the caller
        // opted out of AI imagery (and hasn't uploaded per-row replacements).
        imageSrc: z.string().optional(),
        imageAlt: z.string().max(140).optional(),
      })
    )
    .min(2)
    .max(5),
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "features/alternating-rows",
  displayName: "Alternating image rows",
  description:
    "Image-on-left then image-on-right rows, each with a heading, paragraph, and optional bullets. Use when each feature deserves a real screenshot and longer-form context.",
  aesthetics: [
    "technical-minimal",
    "refined-editorial",
    "warm-humanist",
    "editorial-maximalist",
    "brutalist-technical",
  ],
  slotsSchema,
  exampleSlots: {
    eyebrow: "Three pillars",
    title: "How Folio actually works.",
    rows: [
      {
        title: "Capture without breaking flow",
        body: "Cmd-Shift-K from anywhere on the page. Folio reads what you have selected, what you have open, and saves it with full context. Tagged, dated, searchable.",
        bullets: [
          "Selection + URL + screenshot, one keystroke",
          "Works in any browser, no extension overhead",
          "Local-first storage, syncs when you're online",
        ],
        imagePosition: "right",
        imageSrc:
          "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=1400&q=80",
        imageAlt: "Folio quick-capture interface saving a web selection",
      },
      {
        title: "Search like a research assistant",
        body: "Folio's index is semantic — ask it 'what was that argument about retention in March' and it finds the right thread even if the words don't match. No keyword tuning.",
        bullets: [
          "Semantic + keyword hybrid search",
          "Filter by source, date range, or tag stack",
          "Results in under 200ms for ~100k captures",
        ],
        imagePosition: "left",
        imageSrc:
          "https://images.unsplash.com/photo-1518186285589-2f7649de83e0?auto=format&fit=crop&w=1400&q=80",
        imageAlt: "Folio semantic search results panel",
      },
      {
        title: "Synthesise without rewriting",
        body: "Highlight a stack of captures and Folio drafts a summary in your voice. Use it as a research brief, an essay scaffold, or a memo for the team.",
        bullets: [
          "Summaries match your past writing style",
          "Always cites the source captures inline",
          "Export to Markdown, Notion, or Google Docs",
        ],
        imagePosition: "right",
        imageSrc:
          "https://images.unsplash.com/photo-1494178270175-e96de2971df9?auto=format&fit=crop&w=1400&q=80",
        imageAlt: "Folio synthesis panel showing a generated research brief",
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
      aria-labelledby={slots.title ? "features-alternating-headline" : undefined}
      style={{
        background: tokens.bg,
        color: tokens.text,
        fontFamily: tokens.fontBody,
      }}
      className="relative w-full"
    >
      <div className="mx-auto max-w-[1280px] px-6 py-20 sm:py-28 lg:py-32">
        {slots.title ? (
          <div className="mx-auto mb-16 max-w-[720px] text-center">
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
              id="features-alternating-headline"
              className="text-balance text-3xl leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl"
              style={{
                fontFamily: tokens.fontDisplay,
                letterSpacing: "-0.025em",
                fontWeight: 600,
              }}
            >
              <EditableText slot="title">{slots.title}</EditableText>
            </h2>
          </div>
        ) : null}

        <div className="space-y-24 lg:space-y-32">
          {slots.rows.map((row, i) => {
            const imageFirst = row.imagePosition === "left";
            const hasImage =
              typeof row.imageSrc === "string" && row.imageSrc.length > 0;
            return (
              <article
                key={i}
                className={
                  hasImage
                    ? "grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16"
                    : "mx-auto max-w-[720px]"
                }
              >
                {hasImage ? (
                  <div className={imageFirst ? "lg:order-1" : "lg:order-2"}>
                    <div
                      className="overflow-hidden"
                      style={{
                        borderRadius: tokens.radius,
                        border: `1px solid ${tokens.border}`,
                        boxShadow: tokens.shadow,
                        background: tokens.surface,
                      }}
                    >
                      <img
                        src={row.imageSrc}
                        alt={row.imageAlt ?? ""}
                        className="block h-auto w-full"
                        loading="lazy"
                      />
                    </div>
                  </div>
                ) : null}

                <div
                  className={
                    hasImage
                      ? imageFirst
                        ? "lg:order-2"
                        : "lg:order-1"
                      : ""
                  }
                >
                  <h3
                    className="text-balance text-2xl leading-tight tracking-tight sm:text-3xl lg:text-4xl"
                    style={{
                      fontFamily: tokens.fontDisplay,
                      letterSpacing: "-0.02em",
                      fontWeight: 600,
                      color: tokens.text,
                    }}
                  >
                    <EditableText slot={`rows[${i}].title`}>{row.title}</EditableText>
                  </h3>
                  <p
                    className="mt-4 text-base leading-relaxed sm:text-lg"
                    style={{ color: tokens.textMuted }}
                  >
                    <EditableText slot={`rows[${i}].body`}>{row.body}</EditableText>
                  </p>
                  {row.bullets && row.bullets.length > 0 ? (
                    <ul role="list" className="mt-6 space-y-3">
                      {row.bullets.map((bullet, b) => (
                        <li
                          key={b}
                          className="flex gap-3 text-sm leading-relaxed sm:text-base"
                          style={{ color: tokens.text }}
                        >
                          <span
                            aria-hidden="true"
                            className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ background: tokens.accent }}
                          />
                          <span>
                            <EditableText slot={`rows[${i}].bullets[${b}]`}>{bullet}</EditableText>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};
