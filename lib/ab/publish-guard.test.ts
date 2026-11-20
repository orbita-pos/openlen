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

const { AbExperimentRunningError, assertNoLiveExperiment, resolveAbPublish } = await import("./publish-guard");

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
