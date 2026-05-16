import type { ChatMessage } from "@/lib/together/client";
import { CopySchema, SectionCopySchema } from "./types";
import type { Copy, Plan, SectionCopy, SectionPlan } from "./types";
import { parseJson, runTextStep, type StepContext } from "./_shared";
import {
  COPY_REGEN_TASK_PROMPT,
  buildSystemMessageForStep,
} from "./routing";
import { buildMasterPrompt } from "./master-prompt";

function buildMessages(ctx: StepContext, plan: Plan): ChatMessage[] {
  return [
    {
      role: "system",
      content: buildSystemMessageForStep("copy", {
        palette: ctx.palette,
        plan,
      }),
      cache: true,
    },
    {
      role: "user",
      content: `Brief:\n${ctx.brief}\n\nPlan JSON:\n${JSON.stringify(plan, null, 2)}`,
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

// Single-section copy regeneration prompt — used by /api/regenerate-section.
// Composes the master prompt with the regen-specific task addendum so a
// regenerated section sounds like the rest of the page.
const SectionRegenSchema = SectionCopySchema;

function buildSectionRegenMessages(args: {
  brief: string;
  ctx: StepContext;
  plan: Plan;
  copy: Copy;
  section: SectionPlan;
  currentSectionCopy: SectionCopy | undefined;
  additionalInstruction?: string;
}): ChatMessage[] {
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

  const systemContent = buildMasterPrompt({
    palette: ctx.palette,
    fewShotExamples: [],
    taskSpecificAdditions: COPY_REGEN_TASK_PROMPT,
  });

  return [
    { role: "system", content: systemContent, cache: true },
    { role: "user", content: user },
  ];
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

  return runTextStep<SectionCopy>(ctx, {
    step: "copy",
    buildMessages: () =>
      buildSectionRegenMessages({
        brief: ctx.brief,
        ctx,
        plan: args.plan,
        copy: args.copy,
        section,
        currentSectionCopy,
        additionalInstruction: args.additionalInstruction,
      }),
    callOptions: { responseFormat: "json", temperature: 0.7, maxTokens: 1024 },
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
  return runTextStep<Copy>(ctx, {
    step: "copy",
    buildMessages: () => buildMessages(ctx, plan),
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
