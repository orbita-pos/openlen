import { afterEach, describe, expect, it, vi } from "vitest";
import { createVisualEngine2AReviewSession } from "@/lib/generation/visual-engine-2a-review-session";
import { startVisualEngine2AReviewerServer, type RunningReviewerServer } from "./server";

const token = "a".repeat(48);
const source = [{
  comparisonId: "comparison-1", pilotRunId: "run-1",
  baseline: { normal: "aa/base.jpg", neutral: "aa/base-neutral.jpg" },
  candidate: { normal: "bb/candidate.jpg", neutral: "bb/candidate-neutral.jpg" },
}];
let running: RunningReviewerServer | undefined;

afterEach(async () => { await running?.close(); running = undefined; });

describe("Visual Engine 2A reviewer server", () => {
  it("binds loopback and requires the launch token on every API request", async () => {
    running = await startVisualEngine2AReviewerServer({
      token,
      session: createVisualEngine2AReviewSession("sha256:" + "a".repeat(64), source, () => 0.9),
      persist: async () => undefined,
      recordComparison: async () => undefined,
      readEvidence: async () => Buffer.from([0xff, 0xd8, 0xff]),
    });
    expect(running.origin).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect((await fetch(`${running.origin}/api/session`)).status).toBe(401);
    const response = await fetch(`${running.origin}/api/session`, { headers: { "x-openlen-review-token": token } });
    expect(response.status).toBe(200);
    const serialized = await response.text();
    for (const secret of ["candidate", "baseline", "run-1", token]) expect(serialized).not.toContain(secret);
  });

  it("persists one decision and records only the semantic verdict and forbidden count", async () => {
    const persist = vi.fn(async () => undefined);
    const recordComparison = vi.fn(async () => undefined);
    running = await startVisualEngine2AReviewerServer({
      token,
      session: createVisualEngine2AReviewSession("sha256:" + "a".repeat(64), source, () => 0.9),
      persist,
      recordComparison,
      readEvidence: async () => Buffer.from([0xff]),
    });
    const response = await fetch(`${running.origin}/api/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-openlen-review-token": token },
      body: JSON.stringify({
        comparisonId: "comparison-1", decision: "left",
        requiredSignalsPresent: true, forbiddenSignalsPresent: false, note: "stronger identity",
      }),
    });
    expect(response.status).toBe(200);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(recordComparison).toHaveBeenCalledWith("run-1", {
      verdict: "candidate", acceptedForbiddenSignalCount: 0,
    });
    expect(JSON.stringify(recordComparison.mock.calls)).not.toContain("stronger identity");
  });

  it("serves only opaque evidence routes and rejects traversal", async () => {
    const readEvidence = vi.fn(async () => Buffer.from([0xff]));
    running = await startVisualEngine2AReviewerServer({
      token,
      session: createVisualEngine2AReviewSession("sha256:" + "a".repeat(64), source, () => 0.1),
      persist: async () => undefined,
      recordComparison: async () => undefined,
      readEvidence,
    });
    expect((await fetch(`${running.origin}/evidence/comparison-1/left/normal`)).status).toBe(200);
    expect(readEvidence).toHaveBeenCalledWith("aa/base.jpg");
    expect((await fetch(`${running.origin}/evidence/%2e%2e/left/normal`)).status).toBe(404);
  });
});
