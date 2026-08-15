export type UsageCreditCalculator = (
  inputTokens: number,
  outputTokens: number,
  model: "gemini-flash",
) => number;

export function calculateAiCreationCredits(
  input: {
    copyUsage?: { inputTokens: number; outputTokens: number };
    generatedSectionUsage?: { inputTokens: number; outputTokens: number };
    filled: boolean;
    /** Photographs the page bought. Each one costs real money to make and was
     * being given away: an image is $0.039, which is 0.84 of a credit, so the
     * honest price is one credit each. */
    generatedImages?: number;
  },
  usageCredits: UsageCreditCalculator,
  autofillCreditCost: number,
): number {
  const copyCredits = input.copyUsage
    ? usageCredits(
        input.copyUsage.inputTokens,
        input.copyUsage.outputTokens,
        "gemini-flash",
      )
    : 1;
  const generatedCredits = input.generatedSectionUsage
    ? usageCredits(input.generatedSectionUsage.inputTokens, input.generatedSectionUsage.outputTokens, "gemini-flash")
    : 0;
  const imageCredits = Number.isSafeInteger(input.generatedImages) && (input.generatedImages ?? 0) > 0
    ? (input.generatedImages as number)
    : 0;
  return copyCredits + generatedCredits + imageCredits + (input.filled ? autofillCreditCost : 0);
}
