import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ recordUncharged: vi.fn(async () => undefined) }));
vi.mock("@/lib/credits", () => ({ recordUncharged: mocks.recordUncharged }));

import { modelIdForRole, roleForOperation } from "@/lib/generation/model-policy";

import { recordReviewCost } from "./ledger";

beforeEach(() => vi.clearAllMocks());

describe("recordReviewCost", () => {
  it("records the review for the project owner, charged 0, with its tokens", async () => {
    await recordReviewCost({
      ownerId: "dueno-1",
      projectId: "p1",
      usage: { inputTokens: 40_000, cachedTokens: 30_000, outputTokens: 2_000 },
      costCentiCredits: 120,
    });
    expect(mocks.recordUncharged).toHaveBeenCalledWith("dueno-1", {
      surface: "security_review",
      outcome: "ok",
      projectId: "p1",
      listCenticredits: 120,
      uses: [
        expect.objectContaining({
          provider: "fireworks",
          model: modelIdForRole(roleForOperation("security_review")),
          inputTokens: 40_000,
          cachedTokens: 30_000,
          outputTokens: 2_000,
        }),
      ],
    });
  });

  it("a review that spent nothing records nothing", async () => {
    await recordReviewCost({ ownerId: "dueno-1", projectId: "p1", usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }, costCentiCredits: 0 });
    expect(mocks.recordUncharged).not.toHaveBeenCalled();
  });
});
