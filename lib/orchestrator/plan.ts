import type { ChatMessage } from "@/lib/together/client";
import { PlanSchema } from "./types";
import type { Intent, Plan } from "./types";
import { parseJson, runTextStep, type StepContext } from "./_shared";
import { buildSystemMessageForStep } from "./routing";

export async function plan(ctx: StepContext, intent: Intent): Promise<Plan> {
  const system = await buildSystemMessageForStep("plan", {
    palette: ctx.palette,
    intent,
  });
  const buildMessages = (): ChatMessage[] => [
    { role: "system", content: system.content, cache: true },
    {
      role: "user",
      content: `Brief:\n${ctx.brief}\n\nIntent JSON:\n${JSON.stringify(intent, null, 2)}`,
    },
  ];

  return runTextStep<Plan>(ctx, {
    step: "plan",
    buildMessages,
    mockKey: "plan",
    useFastPath: ctx.fastPath,
    callOptions: { responseFormat: "json", temperature: 0.4, maxTokens: 2048 },
    progressDetail: ctx.fastPath
      ? "Adaptive fast-path planning (simple brief)"
      : "Designing section sequence and visual direction",
    fewShotVariants: system.fewShotVariants,
    validate: (content) => {
      const parsed = parseJson<unknown>(content, "plan");
      const plan = PlanSchema.parse(parsed);
      // Quality gate: must have a hero image prompt and at least one section.
      const hasHero = plan.imagePrompts.some((p) => p.purpose === "hero");
      if (!hasHero) {
        throw new Error("plan: imagePrompts missing a hero entry");
      }
      const heroSection = plan.sections.find((s) => s.kind === "hero");
      if (!heroSection) {
        throw new Error("plan: sections missing a hero entry");
      }
      return plan;
    },
  });
}
