import { describe, expect, it } from "vitest";
import {
  appendVisualEngine2ADecision,
  buildBlindReviewDto,
  completeVisualEngine2AReview,
  createVisualEngine2AReviewSession,
  resumeVisualEngine2AReviewSession,
} from "./visual-engine-2a-review-session";

const source = [{
  comparisonId: "comparison-1", pilotRunId: "run-1",
  baseline: { normal: "aa/base.jpg", neutral: "aa/base-neutral.jpg" },
  candidate: { normal: "bb/candidate.jpg", neutral: "bb/candidate-neutral.jpg" },
}];

describe("Visual Engine 2A blind review session", () => {
  it("randomizes sides while excluding semantic labels and secrets from the DTO", () => {
    const session = createVisualEngine2AReviewSession("sha256:" + "a".repeat(64), source, () => 0.9);
    const dto = buildBlindReviewDto(session);
    const serialized = JSON.stringify(dto);
    expect(dto.current?.left.normalUrl).toMatch(/^\/evidence\//);
    for (const secret of ["baseline", "candidate", "pilotRunId", "sourcePath", "email", "credential"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("resumes only the same source and makes duplicate decisions idempotent", () => {
    const original = createVisualEngine2AReviewSession("sha256:" + "a".repeat(64), source, () => 0.1);
    expect(() => resumeVisualEngine2AReviewSession(original, "sha256:" + "b".repeat(64))).toThrow(/source/i);
    const command = {
      comparisonId: "comparison-1", decision: "left" as const,
      requiredSignalsPresent: true, forbiddenSignalsPresent: false, note: "clearer identity",
    };
    const decided = appendVisualEngine2ADecision(original, command, "2026-08-07T00:00:00.000Z");
    expect(appendVisualEngine2ADecision(decided, command, "2026-08-07T00:00:01.000Z")).toEqual(decided);
    expect(() => appendVisualEngine2ADecision(decided, { ...command, decision: "right" }, "2026-08-07T00:00:01.000Z")).toThrow(/already/i);
  });

  it("completion is immutable", () => {
    const session = createVisualEngine2AReviewSession("sha256:" + "a".repeat(64), source, () => 0.1);
    const decided = appendVisualEngine2ADecision(session, {
      comparisonId: "comparison-1", decision: "tie",
      requiredSignalsPresent: false, forbiddenSignalsPresent: false, note: "too similar",
    }, "2026-08-07T00:00:00.000Z");
    const complete = completeVisualEngine2AReview(decided, "2026-08-07T00:00:01.000Z");
    expect(() => appendVisualEngine2ADecision(complete, {
      comparisonId: "comparison-1", decision: "invalid",
      requiredSignalsPresent: false, forbiddenSignalsPresent: false, note: "render failed",
    }, "2026-08-07T00:00:02.000Z")).toThrow(/completed/i);
  });
});
