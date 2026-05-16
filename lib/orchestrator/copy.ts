import type { ChatMessage } from "@/lib/together/client";
import { CopySchema } from "./types";
import type { Copy, Plan } from "./types";
import { parseJson, runTextStep, type StepContext } from "./_shared";

const SYSTEM_PROMPT = `You write landing-page copy. Specific, benefit-driven, never generic.

Output a SINGLE JSON object — no markdown, no commentary.

Schema:
{
  "sectionTexts": [
    {
      "sectionId": "<must match a section id from the plan>",
      "headline": <short string, omit if not applicable>,
      "subheadline": <short string, omit if not applicable>,
      "body": <paragraph string, omit if not applicable>,
      "ctas": [{ "label": "<verb-led 1-3 words>", "href": "<#anchor or url>" }],
      "items": [
        { "title": <optional>, "description": <optional>, "meta": { "<key>": "<value>" } }
      ]
    }
  ]
}

PROHIBITED phrases (rewrite if you catch yourself reaching for these):
- "lorem ipsum", "lorem"
- "awesome", "amazing", "great experience", "world-class", "next-gen", "cutting-edge"
- "powerful platform that empowers"
- "revolutionize", "disrupt", "transform your business"
- placeholder text like "Lorem ipsum dolor sit amet"

Rules:
- One section text per planned section. Match sectionId exactly.
- Hero headline: ≤8 words. Concrete noun + concrete verb. Name what the product DOES, not how it FEELS.
  GOOD: "Kanban that auto-prioritizes your sprint"
  BAD: "The most powerful project management for modern teams"
- Subheadlines: 1-2 sentences. Add specificity the headline omits.
- Features: title 3-6 words, description 1-2 sentences each. Each feature must name a specific capability the user gets, not a vague benefit.
- Pricing: tier title + price in meta.price + 1-line description. If brief gives prices, use them verbatim.
- Social proof: prefer concrete logo names or metrics over generic "trusted by thousands".
- Footer: simple — product name, tagline, link items.
- CTAs: action verb. "Start free", "Book demo", "See pricing". Never "Learn more" alone.
- Use the brief's product name and details verbatim where possible. Don't invent features the brief doesn't mention.`;

function buildMessages(brief: string, plan: Plan): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT, cache: true },
    {
      role: "user",
      content: `Brief:\n${brief}\n\nPlan JSON:\n${JSON.stringify(plan, null, 2)}`,
    },
  ];
}

// Anti-generic detector. Catches the worst offenders so we can retry with the
// fallback model when the primary slips into marketing-speak.
const GENERIC_REGEX =
  /\b(lorem ipsum|lorem|awesome|amazing|great experience|world-class|next-gen|cutting-edge|revolutionize|empower(?:s|ing|ed)?|disrupt(?:s|ing|ive)?|transform your business)\b/gi;

function countGenericHits(copy: Copy): { count: number; samples: string[] } {
  const samples: string[] = [];
  let count = 0;
  for (const s of copy.sectionTexts) {
    const blob = [
      s.headline,
      s.subheadline,
      s.body,
      ...(s.items ?? []).flatMap((i) => [i.title, i.description]),
    ]
      .filter((v): v is string => typeof v === "string")
      .join(" ");
    const matches = blob.match(GENERIC_REGEX);
    if (matches) {
      count += matches.length;
      for (const m of matches) {
        if (samples.length < 5) samples.push(m.toLowerCase());
      }
    }
  }
  return { count, samples };
}

export async function generateCopy(
  ctx: StepContext,
  plan: Plan,
): Promise<Copy> {
  return runTextStep<Copy>(ctx, {
    step: "copy",
    buildMessages: () => buildMessages(ctx.brief, plan),
    mockKey: "copy",
    callOptions: { responseFormat: "json", temperature: 0.7, maxTokens: 4096 },
    progressDetail: "Writing copy for each section",
    fallbackNote: "Copy quality gate flagged generic phrases; retrying with stricter model.",
    validate: (content) => {
      const parsed = parseJson<unknown>(content, "copy");
      const copy = CopySchema.parse(parsed);

      // Quality gate 1: every planned section must have copy.
      const missing = plan.sections.filter(
        (s) => !copy.sectionTexts.some((c) => c.sectionId === s.id),
      );
      if (missing.length > 0) {
        throw new Error(
          `copy: missing text for sections [${missing.map((s) => s.id).join(", ")}]`,
        );
      }

      // Quality gate 2: anti-generic. >2 hits → trigger fallback.
      const { count, samples } = countGenericHits(copy);
      if (count > 2) {
        throw new Error(
          `copy: ${count} generic-phrase hits in output (samples: ${samples.join(", ")})`,
        );
      }

      return copy;
    },
  });
}
