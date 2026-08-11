export type UsageCreditCalculator = (
  inputTokens: number,
  outputTokens: number,
  model: "gemini-flash",
) => number;

export function calculateAiCreationCredits(
  input: {
    copyUsage?: { inputTokens: number; outputTokens: number };
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
  return copyCredits + (input.filled ? autofillCreditCost : 0);
}
