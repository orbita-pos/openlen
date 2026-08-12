import { describe, expect, it, vi } from "vitest";

import { calculateAiCreationCredits } from "./ai-creation-credits";

describe("calculateAiCreationCredits", () => {
  it("charges copy usage plus the existing autofill cost when fill changed the document", () => {
    const usageCredits = vi.fn(() => 3);

    expect(calculateAiCreationCredits({
      copyUsage: { inputTokens: 120, outputTokens: 30 },
      filled: true,
    }, usageCredits, 2)).toBe(5);
    expect(usageCredits).toHaveBeenCalledWith(120, 30, "gemini-flash");
  });

  it("charges safe aggregated usage for generated missing sections", () => {
    const usageCredits = vi.fn((_input, output) => output);
    expect(calculateAiCreationCredits({
      copyUsage: { inputTokens: 10, outputTokens: 2 },
      generatedSectionUsage: { inputTokens: 20, outputTokens: 3 },
      filled: false,
    }, usageCredits, 2)).toBe(5);
    expect(usageCredits).toHaveBeenNthCalledWith(2, 20, 3, "gemini-flash");
  });

  it("uses the one-credit fallback and no autofill charge when usage is absent and fill made no change", () => {
    const usageCredits = vi.fn(() => 99);

    expect(calculateAiCreationCredits({ filled: false }, usageCredits, 2)).toBe(1);
    expect(usageCredits).not.toHaveBeenCalled();
  });
});
