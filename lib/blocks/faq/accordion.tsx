/**
 * Source: shadcn/ui (MIT) — <Accordion> primitive pattern
 *   https://github.com/shadcn-ui/ui
 * Plus: Tailark (MIT) — faqs-1 layout
 *   https://github.com/tailark/blocks
 * Licenses: MIT — see /LICENSES/shadcn-ui.MIT.txt and /LICENSES/tailark.MIT.txt
 *
 * Adapted: uses native <details>/<summary> instead of pulling
 * @radix-ui/react-accordion, so the block stays dependency-free and renders
 * without client-side JS. Tokens substituted.
 */
import { z } from "zod";
import { Plus } from "lucide-react";
import type {
  BlockComponent,
  BlockComponentProps,
  BlockMeta,
} from "../types";

export const slotsSchema = z.object({
  title: z.string().max(80).optional(),
  sub: z.string().max(200).optional(),
  items: z
    .array(
      z.object({
        q: z.string().max(140),
        a: z.string().max(600),
      })
    )
    .min(3)
    .max(12),
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "faq/accordion",
  displayName: "FAQ accordion",
  description:
    "Native disclosure-style FAQ. Renders without client JS. Use to head off the common questions and pre-empt support tickets.",
  aesthetics: [
    "technical-minimal",
    "refined-editorial",
    "warm-humanist",
    "editorial-maximalist",
    "brutalist-technical",
  ],
  slotsSchema,
  exampleSlots: {
    title: "Questions, answered.",
    sub: "If the answer you need isn't here, write back. We answer in hours, not days.",
    items: [
      {
        q: "Do you train on my prompts?",
        a: "No. Together AI processes generation requests stateless; we don't log prompts to disk and we never train models on them. If you self-host, nothing leaves your network.",
      },
      {
        q: "What happens to pages I cancel?",
        a: "They keep working. Inari output is a single HTML file you own. Cancel any time, your pages stay online wherever you hosted them.",
      },
      {
        q: "Can I bring my own Claude API key?",
        a: "Yes, on the Studio plan. The pipeline routes the html step to Claude Sonnet 4.5 instead of Qwen3-Coder while keeping every other step on Together. You pay Anthropic for that call.",
      },
      {
        q: "How is this different from Lovable?",
        a: "Two things. We're vertical (landing pages only) instead of horizontal (any app), and we compose pre-vetted blocks instead of asking the model to write JSX — so the 'bug loops' Lovable users hit are structurally impossible here.",
      },
      {
        q: "Is the output really one HTML file?",
        a: "Yes — inlined CSS, no JS framework, no npm install required. You can open it locally, drop it on any host, embed it anywhere a file lives.",
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
      aria-labelledby={slots.title ? "faq-accordion-headline" : undefined}
      style={{
        background: tokens.bg,
        color: tokens.text,
        fontFamily: tokens.fontBody,
      }}
      className="relative w-full"
    >
      <div className="mx-auto max-w-[760px] px-6 py-20 sm:py-28 lg:py-32">
        {slots.title ? (
          <div className="mb-12 text-center">
            <h2
              id="faq-accordion-headline"
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
        ) : null}

        <div
          className="divide-y"
          style={{
            borderTop: `1px solid ${tokens.border}`,
            borderBottom: `1px solid ${tokens.border}`,
          }}
        >
          {slots.items.map((item, i) => (
            <details
              key={i}
              className="group"
              style={{ borderBottom: `1px solid ${tokens.border}` }}
            >
              <summary
                className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left"
                style={{ color: tokens.text }}
              >
                <span
                  className="text-base font-medium leading-snug sm:text-lg"
                  style={{
                    fontFamily: tokens.fontDisplay,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {item.q}
                </span>
                <Plus
                  size={18}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="shrink-0 transition-transform duration-200 group-open:rotate-45"
                  style={{ color: tokens.textMuted }}
                />
              </summary>
              <p
                className="pb-5 pr-8 text-sm leading-relaxed sm:text-base"
                style={{ color: tokens.textMuted }}
              >
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
};
