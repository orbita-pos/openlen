import { afterEach, describe, expect, it, vi } from "vitest";
import { createVisualEngine2AReviewSession } from "@/lib/generation/visual-engine-2a-review-session";
import { sha256 } from "@/lib/generation/visual-engine-2a-eval";
import { startVisualEngine2AReviewerServer, type RunningReviewerServer } from "./server";

const token = "a".repeat(48);
const evidenceHash = sha256(Buffer.from([0xff]));
const source = [{
  comparisonId: "comparison-1", pilotRunId: "run-1",
  baseline: { normal: "aa/base.jpg", neutral: "aa/base-neutral.jpg" },
  candidate: { normal: "bb/candidate.jpg", neutral: "bb/candidate-neutral.jpg" },
  hashes: { baseline: { normal: evidenceHash, neutral: evidenceHash }, candidate: { normal: evidenceHash, neutral: evidenceHash } },
}];
const sourceTwo = [...source, {
  comparisonId: "comparison-2", pilotRunId: "run-2",
  baseline: { normal: "cc/base.jpg", neutral: "cc/base-neutral.jpg" },
  candidate: { normal: "dd/candidate.jpg", neutral: "dd/candidate-neutral.jpg" },
  hashes: { baseline: { normal: evidenceHash, neutral: evidenceHash }, candidate: { normal: evidenceHash, neutral: evidenceHash } },
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

  it("rejects evidence bytes substituted after the verified session snapshot", async () => {
    running = await startVisualEngine2AReviewerServer({
      token,
      session: createVisualEngine2AReviewSession("sha256:" + "a".repeat(64), source, () => 0.1),
      persist: async () => undefined,
      recordComparison: async () => undefined,
      readEvidence: async () => Buffer.from("substituted"),
    });
    expect((await fetch(`${running.origin}/evidence/comparison-1/left/normal`)).status).toBe(400);
  });

  it("serializes simultaneous decisions so both durable decisions are preserved", async () => {
    const durable: Array<{ decisions: Array<{ comparisonId: string }> }> = [];
    running = await startVisualEngine2AReviewerServer({
      token,
      session: createVisualEngine2AReviewSession("sha256:" + "a".repeat(64), sourceTwo, () => 0.9),
      persist: async (next) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        durable.push(structuredClone(next));
      },
      recordComparison: async () => undefined,
      readEvidence: async () => Buffer.from([0xff]),
    });
    const decide = (comparisonId: string) => fetch(`${running!.origin}/api/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-openlen-review-token": token },
      body: JSON.stringify({ comparisonId, decision: "tie", requiredSignalsPresent: true, forbiddenSignalsPresent: false, note: `review ${comparisonId}` }),
    });
    const responses = await Promise.all([decide("comparison-1"), decide("comparison-2")]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const state = await (await fetch(`${running.origin}/api/session`, { headers: { "x-openlen-review-token": token } })).json();
    expect(state).toMatchObject({ progress: { decided: 2, total: 2 }, complete: true });
    expect(durable.at(-1)?.decisions.map((decision) => decision.comparisonId).sort()).toEqual(["comparison-1", "comparison-2"]);
  });

  it("records DB-first so a final DB failure stays locally incomplete and retryable", async () => {
    const initial = createVisualEngine2AReviewSession("sha256:" + "a".repeat(64), source, () => 0.9);
    let durable = structuredClone(initial);
    let attempts = 0;
    running = await startVisualEngine2AReviewerServer({
      token, session: initial,
      persist: async (next) => { durable = structuredClone(next); },
      recordComparison: async () => { attempts += 1; if (attempts === 1) throw new Error("db unavailable"); },
      readEvidence: async () => Buffer.from([0xff]),
    });
    const request = () => fetch(`${running!.origin}/api/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-openlen-review-token": token },
      body: JSON.stringify({ comparisonId: "comparison-1", decision: "left", requiredSignalsPresent: true, forbiddenSignalsPresent: false, note: "clear identity" }),
    });
    expect((await request()).status).toBe(400);
    expect(durable).toMatchObject({ decisions: [], completedAt: null });
    const afterFailure = await (await fetch(`${running.origin}/api/session`, { headers: { "x-openlen-review-token": token } })).json();
    expect(afterFailure).toMatchObject({ progress: { decided: 0, total: 1 }, complete: false });
    expect((await request()).status).toBe(200);
    expect(durable).toMatchObject({ decisions: [{ comparisonId: "comparison-1" }], completedAt: expect.any(String) });
    expect(attempts).toBe(2);
  });
});
