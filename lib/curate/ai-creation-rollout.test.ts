import { describe, expect, it } from "vitest";

import {
  aiCreationRolloutBucket,
  isUserInAiCreationRollout,
  parseAiCreationRolloutPercent,
} from "./ai-creation-rollout";

describe("AI creation percentage rollout", () => {
  it("uses stable hand-checked SHA-256 buckets", () => {
    expect(aiCreationRolloutBucket("fable-user")).toBe(3);
    expect(aiCreationRolloutBucket("outside-user")).toBe(52);
    expect(aiCreationRolloutBucket("fable-user")).toBe(3);
  });

  it.each([undefined, "", "0", "100", "1.5", "01", "garbage"])("rejects invalid rollout percent %s", (value) => {
    expect(parseAiCreationRolloutPercent(value)).toBeNull();
    expect(isUserInAiCreationRollout("fable-user", {
      OPENLEN_AI_CREATION: "enabled",
      ...(value === undefined ? {} : { OPENLEN_AI_CREATION_ROLLOUT_PERCENT: value }),
    })).toBe(false);
  });

  it("keeps disabled at zero and admits only stable buckets below 1..99", () => {
    expect(isUserInAiCreationRollout("fable-user", { OPENLEN_AI_CREATION: "disabled", OPENLEN_AI_CREATION_ROLLOUT_PERCENT: "99" })).toBe(false);
    expect(isUserInAiCreationRollout("fable-user", { OPENLEN_AI_CREATION: "enabled", OPENLEN_AI_CREATION_ROLLOUT_PERCENT: "4" })).toBe(true);
    expect(isUserInAiCreationRollout("outside-user", { OPENLEN_AI_CREATION: "enabled", OPENLEN_AI_CREATION_ROLLOUT_PERCENT: "50" })).toBe(false);
  });
});
