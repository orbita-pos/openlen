import type { ChatMessage } from "@/lib/together/client";
import { IntentSchema } from "./types";
import type { Intent } from "./types";
import { parseJson, runTextStep, type StepContext } from "./_shared";
import { buildSystemMessageForStep } from "./routing";

function buildMessages(ctx: StepContext): ChatMessage[] {
  return [
    {
      role: "system",
      content: buildSystemMessageForStep("classify", { palette: ctx.palette }),
      cache: true,
    },
    { role: "user", content: `Brief:\n${ctx.brief}` },
  ];
}

export async function classify(ctx: StepContext): Promise<Intent> {
  return runTextStep<Intent>(ctx, {
    step: "classify",
    buildMessages: () => buildMessages(ctx),
    mockKey: "classify",
    callOptions: { responseFormat: "json", temperature: 0.1, maxTokens: 512 },
    progressDetail: "Parsing brief into structured intent",
    validate: (content) => {
      const parsed = parseJson<unknown>(content, "classify");
      return IntentSchema.parse(parsed);
    },
  });
}
