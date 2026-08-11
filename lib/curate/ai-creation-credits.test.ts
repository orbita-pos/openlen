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

  it("uses the one-credit fallback and no autofill charge when usage is absent and fill made no change", () => {
    const usageCredits = vi.fn(() => 99);

    expect(calculateAiCreationCredits({ filled: false }, usageCredits, 2)).toBe(1);
    expect(usageCredits).not.toHaveBeenCalled();
  });
});
