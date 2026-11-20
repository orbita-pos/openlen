// @vitest-environment node
// EVERY PUBLISH DOOR RESPECTS A LIVE EXPERIMENT (review item 13).
//
// A release written without the manifest ends the split in silence while the row says `running`, and the decision that
// follows (keep A / harm stop) rolls back to an older release. The decision is made at the bottom door, in one place:
//   · a system republish (republish-all, internal republish) re-emits the experiment: same Variant B, new Control;
//   · the experiment's own decision (promote, restore control) and an owner who chose «Stop and publish» are `ending`;
//   · anyone else — Len Watch, MCP publish, an unpublish — is refused with `ab_experiment_running`.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { AbExperimentRunningError, assertNoLiveExperiment, endExperimentAfterPublish, resolveAbPublish } = await import("./publish-guard");

const EXP = { id: "ab_1234abcd", name: "Direct hero", targetPath: "/", status: "running", controlReleaseSha: "rel-c" } as never;
const REBUILT = { experiment: EXP, sourcesOverride: { data: { html: "A" }, folder: {} }, abExperiment: { id: "ab_1234abcd" }, protectReleaseShas: ["rel-c"] } as never;

function deps(over: Partial<Parameters<typeof resolveAbPublish>[1] & object> = {}) {
  const d = {
    enabled: vi.fn(() => true),
    liveExperiment: vi.fn(async () => EXP),
    rebuild: vi.fn(async () => REBUILT),
    ...over,
  };
  return d as typeof d & Parameters<typeof resolveAbPublish>[1];
}
const base = { projectId: "p1", ownerId: "o1", carriesExperiment: false };

describe("resolveAbPublish", () => {
  it("🔴 flag off: nothing is looked up at all (publishing is what it always was)", async () => {
    const d = deps({ enabled: vi.fn(() => false) });
    await expect(resolveAbPublish(base, d)).resolves.toBeNull();
    expect(d.liveExperiment).not.toHaveBeenCalled();
  });

  it("the publish that CARRIES the experiment (the launch) is never refused or rebuilt", async () => {
    const d = deps();
    await expect(resolveAbPublish({ ...base, carriesExperiment: true }, d)).resolves.toBeNull();
    expect(d.liveExperiment).not.toHaveBeenCalled();
  });

  it("no live experiment: a plain publish", async () => {
    const d = deps({ liveExperiment: vi.fn(async () => null) });
    await expect(resolveAbPublish(base, d)).resolves.toBeNull();
    await expect(resolveAbPublish({ ...base, policy: "keep" }, d)).resolves.toBeNull();
    expect(d.rebuild).not.toHaveBeenCalled();
  });

  it("🔴 a live experiment and nobody said what to do (Len Watch, MCP publish…): refused, naming it", async () => {
    const d = deps();
    const err = await resolveAbPublish(base, d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AbExperimentRunningError);
    expect(err).toMatchObject({ experimentId: "ab_1234abcd", experimentName: "Direct hero", targetPath: "/" });
    expect((err as Error).message).toMatch(/A\/B test/);
    expect(d.rebuild).not.toHaveBeenCalled();
  });

  it("🔴 «ending» (the experiment's own decision, or «Stop and publish») goes through", async () => {
    const d = deps();
    await expect(resolveAbPublish({ ...base, policy: "ending" }, d)).resolves.toBeNull();
    expect(d.rebuild).not.toHaveBeenCalled();
  });

  it("🔴 a system republish («keep») re-emits the experiment: it gets the rebuilt Control+B to publish", async () => {
    const d = deps();
    await expect(resolveAbPublish({ ...base, policy: "keep" }, d)).resolves.toBe(REBUILT);
    expect(d.rebuild).toHaveBeenCalledWith(EXP, "o1");
  });

  it("a system republish that can't rebuild the experiment is refused: it must not end it", async () => {
    const d = deps({ rebuild: vi.fn(async () => null) });
    await expect(resolveAbPublish({ ...base, policy: "keep" }, d)).rejects.toBeInstanceOf(AbExperimentRunningError);
  });
});

describe("assertNoLiveExperiment (unpublish, rollback)", () => {
  it("flag off or nothing live: fine", async () => {
    await expect(assertNoLiveExperiment("p1", deps({ enabled: vi.fn(() => false) }))).resolves.toBeUndefined();
    await expect(assertNoLiveExperiment("p1", deps({ liveExperiment: vi.fn(async () => null) }))).resolves.toBeUndefined();
  });

  it("🔴 a live experiment: refused the same way", async () => {
    await expect(assertNoLiveExperiment("p1", deps())).rejects.toBeInstanceOf(AbExperimentRunningError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// CLOSING THE EXPERIMENT AFTER «STOP AND PUBLISH» (G1+G3 review, item 20): the publish is done, the row has to follow. A
// failed close is tried once more; the experiment must not stay `running` with a release that has no split.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("endExperimentAfterPublish", () => {
  const ROW = { id: "ab_1234abcd", projectId: "p1", copyProjectId: "copy-1", branch: "ab/ab_1234abcd" } as never;
  const endDeps = (cancel: ReturnType<typeof vi.fn>) => ({ cancel, cleanup: vi.fn(async () => undefined) });

  it("🔴 a close that fails is retried once, and the worktree is cleaned when the retry succeeds", async () => {
    const cancel = vi.fn().mockRejectedValueOnce(new Error("db blip")).mockResolvedValueOnce({ id: "ab_1234abcd" });
    const d = endDeps(cancel);
    await endExperimentAfterPublish(ROW, "u1", d);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(d.cleanup).toHaveBeenCalledWith({ parentId: "p1", copyProjectId: "copy-1", branch: "ab/ab_1234abcd" });
  });

  it("fails twice: it says so (the publish is done, nothing is thrown) and cleans nothing", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("db down"));
    const d = endDeps(cancel);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(endExperimentAfterPublish(ROW, "u1", d)).resolves.toBeUndefined();
    error.mockRestore();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(d.cleanup).not.toHaveBeenCalled();
  });

  it("someone decided it meanwhile (the conditional close changes nothing): not ours to touch, no retry, no cleanup", async () => {
    const cancel = vi.fn().mockResolvedValue(null);
    const d = endDeps(cancel);
    await endExperimentAfterPublish(ROW, "u1", d);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(d.cleanup).not.toHaveBeenCalled();
  });
});
