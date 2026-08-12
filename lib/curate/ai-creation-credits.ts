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
  return copyCredits + generatedCredits + (input.filled ? autofillCreditCost : 0);
}
