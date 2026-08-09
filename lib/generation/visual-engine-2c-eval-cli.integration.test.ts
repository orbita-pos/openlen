import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVisualEngine2CEvalCli, writeVisualEngine2CEvidence } from "@/scripts/visual-engine-2c-eval";
import { loadVisualEngine2AReviewSource } from "./visual-engine-2a-review-session";
import { qualifyVisualEngine2CCohort } from "./visual-engine-2c-qualification";

async function fixture() {
  const qualified = await qualifyVisualEngine2CCohort({ commitSha: "a".repeat(40), evaluate: async (row) => ({ resultCode: row.class, inputHash: `sha256:${"1".repeat(64)}`, outputHash: `sha256:${"2".repeat(64)}` }) });
  const order: string[] = [];
  const deps = {
    env: {
      OPENLEN_VISUAL_ENGINE_REPAIR: "shadow", OPENLEN_VISUAL_ENGINE_2C_AUTHORIZATION: "AUTHORIZED_2C_SMOKE_ONCE",
      OPENLEN_VISUAL_ENGINE_2C_PILOT_BUDGET_MICROMXN: "30000000",
    },
    rateCardReady: true,
    getCommitSha: vi.fn(async () => { order.push("head"); return "a".repeat(40); }),
    getQuota: vi.fn(async () => { order.push("quota"); return { limit: 150, used: 0, existingRuns: 0 }; }),
    readQualification: vi.fn(async () => { order.push("qualification"); return qualified.manifest; }),
    reserve: vi.fn(async (index: number) => { order.push(`reserve:${index}`); return { ok: true as const, id: `id-${index}`, ordinal: index + 1 }; }),
    evaluate: vi.fn(async (index: number) => ({ providerCalls: index < 6 ? 1 : index < 12 ? 3 : 1, costMicromxn: 1000, status: index < 12 ? "adapted" as const : "fallback" as const })),
    complete: vi.fn(async () => undefined), log: vi.fn(),
  };
  return { qualified, order, deps };
}

describe("runVisualEngine2CEvalCli", () => {
  it("runs 15 cases only after qualification, HEAD and quota are rechecked", async () => {
    const state = await fixture();
    const result = await runVisualEngine2CEvalCli(state.deps, "C:\\repo");
    expect(result).toMatchObject({ ok: true, reservations: 15, providerCalls: 27 });
    expect(state.order.slice(0, 5)).toEqual(["head", "quota", "qualification", "head", "quota"]);
    expect(state.order[5]).toBe("reserve:0");
    expect(state.deps.evaluate).toHaveBeenNthCalledWith(1, 0, { ok: true, id: "id-0", ordinal: 1 });
  });
  it("closes stale and unauthorized runs before reservation", async () => {
    const unauthorized = await fixture(); unauthorized.deps.env.OPENLEN_VISUAL_ENGINE_2C_AUTHORIZATION = "wrong";
    expect(await runVisualEngine2CEvalCli(unauthorized.deps)).toMatchObject({ ok: false });
    expect(unauthorized.deps.reserve).not.toHaveBeenCalled();
    const stale = await fixture(); stale.deps.getCommitSha.mockResolvedValue("b".repeat(40));
    expect(await runVisualEngine2CEvalCli(stale.deps)).toMatchObject({ ok: false, code: "qualification_stale" });
    expect(stale.deps.reserve).not.toHaveBeenCalled();
  });

  it("writes hash-bound original/repaired desktop/mobile evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "openlen-2c-evidence-"));
    await writeVisualEngine2CEvidence(root, {
      caseId: "repair-07",
      pilotRunId: "run-7",
      baselineNormal: Buffer.from("baseline-desktop"),
      baselineNeutral: Buffer.from("baseline-mobile"),
      candidateNormal: Buffer.from("candidate-desktop"),
      candidateNeutral: Buffer.from("candidate-mobile"),
    });
    const source = await loadVisualEngine2AReviewSource(root);
    expect(source.rows).toHaveLength(1);
    expect(source.rows[0]).toMatchObject({ pilotRunId: "run-7" });
    expect(JSON.parse(await readFile(join(root, source.rows[0]!.baseline.normal.replace("baselineNormal.jpg", "manifest.json")), "utf8"))).not.toHaveProperty("html");
  });
});
