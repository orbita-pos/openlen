import type { ChatMessage } from "@/lib/together/client";
import { IntentSchema } from "./types";
import type { Intent } from "./types";
import { parseJson, runTextStep, type StepContext } from "./_shared";
import { buildSystemMessageForStep } from "./routing";

export async function classify(ctx: StepContext): Promise<Intent> {
  const system = await buildSystemMessageForStep("classify", {
    palette: ctx.palette,
  });
  const buildMessages = (): ChatMessage[] => [
    { role: "system", content: system.content, cache: true },
    { role: "user", content: `Brief:\n${ctx.brief}` },
  ];

  return runTextStep<Intent>(ctx, {
    step: "classify",
    buildMessages,
    mockKey: "classify",
    callOptions: { responseFormat: "json", temperature: 0.1, maxTokens: 512 },
    progressDetail: "Parsing brief into structured intent",
    fewShotVariants: system.fewShotVariants,
    validate: (content) => {
      const parsed = parseJson<unknown>(content, "classify");
      return IntentSchema.parse(parsed);
    },
  });
}
