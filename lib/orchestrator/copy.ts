import type { ChatMessage } from "@/lib/together/client";
import { CopySchema, SectionCopySchema } from "./types";
import type { Copy, Plan, SectionCopy, SectionPlan } from "./types";
import { parseJson, runTextStep, type StepContext } from "./_shared";
import {
  COPY_REGEN_TASK_PROMPT,
  buildSystemMessageForStep,
} from "./routing";
import { buildMasterPrompt } from "./master-prompt";
import { loadFewShots } from "./few-shots";

async function buildCopyMessages(
  ctx: StepContext,
  plan: Plan,
): Promise<{ messages: ChatMessage[]; fewShotVariants: string[] }> {
  const system = await buildSystemMessageForStep("copy", {
    palette: ctx.palette,
    plan,
  });
  return {
    messages: [
      { role: "system", content: system.content, cache: true },
      {
        role: "user",
        content: `Brief:\n${ctx.brief}\n\nPlan JSON:\n${JSON.stringify(plan, null, 2)}`,
      },
    ],
    fewShotVariants: system.fewShotVariants,
  };
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

// Single-section copy regeneration prompt — used by /api/regenerate-section.
// Composes the master prompt with the regen-specific task addendum so a
// regenerated section sounds like the rest of the page.
const SectionRegenSchema = SectionCopySchema;

async function buildSectionRegenMessages(args: {
  brief: string;
  ctx: StepContext;
  plan: Plan;
  copy: Copy;
  section: SectionPlan;
  currentSectionCopy: SectionCopy | undefined;
  additionalInstruction?: string;
}): Promise<{ messages: ChatMessage[]; fewShotVariants: string[] }> {
  const {
    brief,
    ctx,
    plan,
    copy,
    section,
    currentSectionCopy,
    additionalInstruction,
  } = args;
  const others = copy.sectionTexts.filter((s) => s.sectionId !== section.id);
  const user = [
    `Brief:\n${brief}`,
    `\nPlan section to rewrite:\n${JSON.stringify(section, null, 2)}`,
    currentSectionCopy
      ? `\nCurrent copy for this section (do not preserve verbatim — rewrite):\n${JSON.stringify(currentSectionCopy, null, 2)}`
      : "",
    `\nOther sections (for voice consistency):\n${JSON.stringify(others, null, 2)}`,
    `\nGlobal voice direction:\n${plan.copyDirection}`,
    additionalInstruction
      ? `\nUser instruction (MUST follow):\n${additionalInstruction}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Regen is a copy-variant creative step; it benefits from the same few-shot
  // corpus as the full copy step. Pin the preferred direction to whatever the
  // page's palette suggests so the rewritten section stays in voice.
  const fewShots = await loadFewShots({
    preferredDirection: ctx.palette.aestheticDirections[0],
  });
  const systemContent = buildMasterPrompt({
    palette: ctx.palette,
    fewShotExamples: fewShots,
    taskSpecificAdditions: COPY_REGEN_TASK_PROMPT,
  });

  return {
    messages: [
      { role: "system", content: systemContent, cache: true },
      { role: "user", content: user },
    ],
    fewShotVariants: fewShots.map((ex) => `${ex.direction}/${ex.variant}`),
  };
}

/**
 * Regenerate copy for a single section. Used by the regenerate-section API
 * route — both the bare "regenerate" button and the edit-prompt modal (which
 * passes `additionalInstruction`).
 */
export async function regenerateSectionCopy(
  ctx: StepContext,
  args: {
    plan: Plan;
    copy: Copy;
    sectionId: string;
    additionalInstruction?: string;
  },
): Promise<SectionCopy> {
  const section = args.plan.sections.find((s) => s.id === args.sectionId);
  if (!section) {
    throw new Error(`regenerate-section: section id "${args.sectionId}" not found in plan`);
  }
  const currentSectionCopy = args.copy.sectionTexts.find(
    (s) => s.sectionId === args.sectionId,
  );

  const { messages, fewShotVariants } = await buildSectionRegenMessages({
    brief: ctx.brief,
    ctx,
    plan: args.plan,
    copy: args.copy,
    section,
    currentSectionCopy,
    additionalInstruction: args.additionalInstruction,
  });
  return runTextStep<SectionCopy>(ctx, {
    step: "copy",
    buildMessages: () => messages,
    callOptions: { responseFormat: "json", temperature: 0.7, maxTokens: 1024 },
    fewShotVariants,
    progressDetail: `Rewriting section "${args.sectionId}"`,
    validate: (content) => {
      const parsed = parseJson<unknown>(content, "regen-copy");
      const out = SectionRegenSchema.parse(parsed);
      if (out.sectionId !== args.sectionId) {
        throw new Error(
          `regen-copy: model returned sectionId "${out.sectionId}", expected "${args.sectionId}"`,
        );
      }
      return out;
    },
  });
}

export async function generateCopy(
  ctx: StepContext,
  plan: Plan,
): Promise<Copy> {
  // System message is stable across retries; compute once and reuse.
  const { messages, fewShotVariants } = await buildCopyMessages(ctx, plan);
  return runTextStep<Copy>(ctx, {
    step: "copy",
    buildMessages: () => messages,
    mockKey: "copy",
    fewShotVariants,
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
