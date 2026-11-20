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

const { AbBringPendingError, AbExperimentRunningError, AbRepublishSkipped, assertNoLiveExperiment, assertNoUnbroughtWinner, endExperimentAfterPublish, resolveAbPublish } = await import("./publish-guard");

const EXP = { id: "ab_1234abcd", name: "Direct hero", targetPath: "/", status: "running", controlReleaseSha: "rel-c", startedAt: new Date(), decisionStatus: "none" } as never;
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
  const endDeps = (cancel: ReturnType<typeof vi.fn>) => ({ cancel, cleanup: vi.fn(async () => undefined), purge: vi.fn(async () => undefined) });

  it("🔴 a close that fails is retried once, and the worktree is cleaned when the retry succeeds", async () => {
    const cancel = vi.fn().mockRejectedValueOnce(new Error("db blip")).mockResolvedValueOnce({ id: "ab_1234abcd" });
    const d = endDeps(cancel);
    await endExperimentAfterPublish(ROW, "u1", d);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(d.cleanup).toHaveBeenCalledWith({ parentId: "p1", copyProjectId: "copy-1", branch: "ab/ab_1234abcd" });
    // the close is handed the CLAIMED row (it carries the lock's token: the close is fenced on it)
    expect(cancel).toHaveBeenCalledWith(ROW, "u1");
  });

  it("🔴 an experiment stopped by a publish is purged from the edge (item 24); one decided meanwhile isn't ours", async () => {
    const closed = endDeps(vi.fn().mockResolvedValue({ id: "ab_1234abcd" }));
    await endExperimentAfterPublish(ROW, "u1", closed);
    expect(closed.purge).toHaveBeenCalledWith(ROW);
    const decided = endDeps(vi.fn().mockResolvedValue(null));
    await endExperimentAfterPublish(ROW, "u1", decided);
    expect(decided.purge).not.toHaveBeenCalled();
  });

  it("a purge that fails doesn't stop the worktree cleanup", async () => {
    const d = endDeps(vi.fn().mockResolvedValue({ id: "ab_1234abcd" }));
    d.purge.mockRejectedValue(new Error("cloudflare"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await endExperimentAfterPublish(ROW, "u1", d);
    error.mockRestore();
    expect(d.cleanup).toHaveBeenCalledTimes(1);
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A SYSTEM RE-EMIT TAKES NO CLAIM, SO IT LEAVES ALONE WHAT A DECISION HOLDS (review: writers outside the claim).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("a system republish (keep) and an experiment being decided", () => {
  const WITH = (over: Record<string, unknown>) => ({ ...(EXP as object), startedAt: new Date(), decisionStatus: "none", ...over }) as never;

  it("🔴 a decision is being applied: the republish is SKIPPED (a log line, an AbRepublishSkipped), nothing is rebuilt", async () => {
    const d = deps({ liveExperiment: vi.fn(async () => WITH({ decisionStatus: "applying" })) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = await resolveAbPublish({ ...base, policy: "keep" }, d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AbRepublishSkipped);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/skipped project p1/);
    warn.mockRestore();
    expect(d.rebuild).not.toHaveBeenCalled();
  });

  it("a launch that hasn't finished (no start yet) is skipped the same way", async () => {
    const d = deps({ liveExperiment: vi.fn(async () => WITH({ startedAt: null })) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(resolveAbPublish({ ...base, policy: "keep" }, d)).rejects.toBeInstanceOf(AbRepublishSkipped);
    warn.mockRestore();
  });

  it("with no decision in progress the republish re-emits as before", async () => {
    const d = deps({ liveExperiment: vi.fn(async () => WITH({})) });
    await expect(resolveAbPublish({ ...base, policy: "keep" }, d)).resolves.toBe(REBUILT);
  });

  it("the ending policies never look: the decision itself (and «Stop and publish», which holds the lock) is what publishes", async () => {
    const d = deps({ liveExperiment: vi.fn(async () => WITH({ decisionStatus: "applying" })) });
    await expect(resolveAbPublish({ ...base, policy: "ending" }, d)).resolves.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE BRING GATE IN THE BOTTOM DOOR (review): a publish from the draft while the promoted winner isn't in it.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("assertNoUnbroughtWinner", () => {
  const WINNER = { id: "ab_promo0001", name: "Hero test", status: "promoted_b", bringState: "conflict" } as never;
  const gate = (pending: unknown, enabled = true) => ({ enabled: () => enabled, pending: vi.fn(async () => pending as never) });

  it("🔴 a person's (or MCP's) publish from the draft is refused with ab_bring_pending, and the message says how to resolve it", async () => {
    const err = await assertNoUnbroughtWinner({ projectId: "p1", system: false }, gate(WINNER)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AbBringPendingError);
    expect((err as InstanceType<typeof AbBringPendingError>).body).toEqual({ error: "ab_bring_pending", experimentId: "ab_promo0001", name: "Hero test", bringState: "conflict" });
    expect((err as Error).message).toMatch(/Bring into draft/);
    expect((err as Error).message).toMatch(/Discard/);
  });

  it("🔴 a system sweep SKIPS the project, with a log line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(assertNoUnbroughtWinner({ projectId: "p1", system: true }, gate(WINNER))).rejects.toBeInstanceOf(AbRepublishSkipped);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/skipped project p1/);
    warn.mockRestore();
  });

  it("nothing pending, or the flag off: nothing happens (and with the flag off nothing is asked)", async () => {
    await expect(assertNoUnbroughtWinner({ projectId: "p1", system: false }, gate(null))).resolves.toBeUndefined();
    const off = gate(WINNER, false);
    await expect(assertNoUnbroughtWinner({ projectId: "p1", system: false }, off)).resolves.toBeUndefined();
    expect(off.pending).not.toHaveBeenCalled();
  });
});
