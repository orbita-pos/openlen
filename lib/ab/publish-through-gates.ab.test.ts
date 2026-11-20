// @vitest-environment node
// «STOP AND PUBLISH» AND THE OTHER DOORS (review items 13 and 14), through the publish gates.
//
// · The owner's publish over a live experiment is asked first (428 `ab_experiment_running`); once they confirm
//   (`stopActiveAb`), the publish goes with `abLive: "ending"` and the experiment is CANCELLED ONLY AFTER it succeeded:
//   a failed publish leaves the split live and untouched (it used to cancel first).
// · Anyone else (Len Watch, a publish that raced a launch…) is told 409 `ab_experiment_running`; the experiment's own
//   promote publishes as `ending`.
import { beforeEach, describe, expect, it, vi } from "vitest";

const enabled = vi.hoisted(() => ({ on: true }));
const m = vi.hoisted(() => ({
  publishProject: vi.fn(),
  gate: vi.fn(),
  live: vi.fn(),
  unbrought: vi.fn(),
  endAfterPublish: vi.fn(),
  claim: vi.fn(),
  hold: vi.fn(),
  release: vi.fn(),
  stop: vi.fn(),
  order: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/ab/enabled", () => ({ abTestingEnabled: () => enabled.on }));
vi.mock("@/lib/ab/store", () => ({ liveExperimentForProject: m.live, pendingBringForProject: m.unbrought, claimExperimentDecision: m.claim }));
vi.mock("@/lib/ab/decision-lock", () => ({ holdDecision: m.hold }));
vi.mock("@/lib/ab/publish-guard", () => ({ endExperimentAfterPublish: m.endAfterPublish }));
vi.mock("@/lib/security-review/real", () => ({
  securityReviewer: () => ({ gate: m.gate, wait: vi.fn(async () => null), markPublished: vi.fn(async () => undefined) }),
}));
vi.mock("@/lib/len-watch/orchestrate", () => ({ afterOwnerPublish: vi.fn(async () => undefined) }));
vi.mock("@/lib/len-watch/bring", () => ({ pendingFix: async () => null, declineFix: vi.fn() }));
vi.mock("@/lib/projects", () => {
  class E extends Error {}
  return {
    publishProject: m.publishProject,
    ProjectNotFoundError: class extends E {},
    SubdomainInvalidError: class extends E {},
    SubdomainLimitError: class extends E {},
    SubdomainTakenError: class extends E {},
  };
});

const { publishThroughGates } = await import("@/lib/projects/publish-through-gates");
const { AbExperimentRunningError } = await import("./errors");

const EXP = { id: "ab_1234abcd", name: "Direct hero", targetPath: "/", status: "running", copyProjectId: "copy-1", branch: "ab/ab_1234abcd" };
const INPUT = { projectId: "p1", actorId: "u1", ownerId: "u1", subdomain: "holi", source: "person" as const };

beforeEach(() => {
  vi.clearAllMocks();
  m.order.length = 0;
  enabled.on = true;
  m.gate.mockResolvedValue({ kind: "open", view: { fingerprint: "f".repeat(64) } });
  m.live.mockResolvedValue(EXP);
  m.unbrought.mockResolvedValue(null);
  // «Stop and publish» claims the decision first: the claimed row carries the lock's token.
  m.claim.mockImplementation(async () => ({ ...EXP, decisionStatus: "applying", decisionLockToken: "tok-1" }));
  m.hold.mockImplementation((row: unknown) => ({ row, release: m.release, stop: m.stop, close: vi.fn() }));
  m.publishProject.mockImplementation(async () => {
    m.order.push("publish");
    return { subdomain: "holi", url: "https://holi.openlen.app", sha: "rel-1" };
  });
  m.endAfterPublish.mockImplementation(async () => void m.order.push("end-experiment"));
});

describe("the owner's publish over a live experiment", () => {
  it("🔴 asks first: 428 ab_experiment_running, and nothing is published or touched", async () => {
    const r = await publishThroughGates(INPUT);
    expect(r).toEqual({ status: 428, body: { error: "ab_experiment_running", experimentId: "ab_1234abcd", name: "Direct hero", targetPath: "/" } });
    expect(m.publishProject).not.toHaveBeenCalled();
    expect(m.endAfterPublish).not.toHaveBeenCalled();
  });

  it("🔴 «Stop and publish»: publishes as `ending`, and the experiment is cancelled AFTER the publish", async () => {
    const r = await publishThroughGates({ ...INPUT, stopActiveAb: true });
    expect(r.status).toBe(200);
    expect(m.publishProject).toHaveBeenCalledWith(expect.objectContaining({ abLive: "ending" }));
    // it closes the CLAIMED row (the one that carries the lock's token)
    expect(m.endAfterPublish).toHaveBeenCalledWith(expect.objectContaining({ id: "ab_1234abcd", decisionLockToken: "tok-1" }), "u1");
    expect(m.order).toEqual(["publish", "end-experiment"]);
    expect(m.stop).toHaveBeenCalledTimes(1); // the heartbeat of the lock stops
    expect(m.release).not.toHaveBeenCalled();
  });

  it("🔴 «Stop and publish» CLAIMS the decision before it publishes — and if it can't (a decision is being applied), it is 409 ab_decision_in_progress and publishes nothing", async () => {
    m.claim.mockResolvedValue(null);
    const r = await publishThroughGates({ ...INPUT, stopActiveAb: true });
    expect(r).toEqual({ status: 409, body: { error: "ab_decision_in_progress", experimentId: "ab_1234abcd", name: "Direct hero" } });
    expect(m.publishProject).not.toHaveBeenCalled();
    expect(m.endAfterPublish).not.toHaveBeenCalled();
    expect(m.hold).not.toHaveBeenCalled();
  });

  it("🔴 a publish that fails gives the lock back (fenced) and stops its heartbeat; the experiment stays as it was", async () => {
    m.publishProject.mockRejectedValueOnce(new Error("disco lleno"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await publishThroughGates({ ...INPUT, stopActiveAb: true });
    error.mockRestore();
    expect(r.status).toBe(500);
    expect(m.release).toHaveBeenCalledTimes(1);
    expect(m.stop).toHaveBeenCalledTimes(1);
    expect(m.endAfterPublish).not.toHaveBeenCalled();
  });

  it("a claim that can't be read is a clean 503, and nothing is published", async () => {
    m.claim.mockRejectedValue(new Error("connection terminated"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await publishThroughGates({ ...INPUT, stopActiveAb: true });
    error.mockRestore();
    expect(r).toEqual({ status: 503, body: { error: "ab_unavailable" } });
    expect(m.publishProject).not.toHaveBeenCalled();
  });

  it("🔴 a publish that fails leaves the experiment live and untouched", async () => {
    m.publishProject.mockRejectedValueOnce(new Error("disco lleno"));
    const r = await publishThroughGates({ ...INPUT, stopActiveAb: true });
    expect(r.status).toBe(500);
    expect(m.endAfterPublish).not.toHaveBeenCalled();
  });

  it("with the flag off, nothing about experiments is looked up and no `abLive` is passed", async () => {
    enabled.on = false;
    await publishThroughGates({ ...INPUT, stopActiveAb: true });
    expect(m.live).not.toHaveBeenCalled();
    expect(m.endAfterPublish).not.toHaveBeenCalled();
    expect(m.publishProject.mock.calls[0]![0]).not.toHaveProperty("abLive");
  });

  it("no live experiment: a plain publish (and a stray `stopActiveAb` ends nothing)", async () => {
    m.live.mockResolvedValue(null);
    expect((await publishThroughGates({ ...INPUT, stopActiveAb: true })).status).toBe(200);
    expect(m.endAfterPublish).not.toHaveBeenCalled();
  });
});

describe("a promoted winner that isn't in the draft yet (item 26)", () => {
  const UNBROUGHT = { id: "ab_promo0001", name: "Hero test", status: "promoted_b", bringState: "conflict" };

  it("🔴 the owner's next publish is refused (428 ab_bring_pending) until they bring it in or discard it: it would undo the promotion", async () => {
    m.live.mockResolvedValue(null);
    m.unbrought.mockResolvedValue(UNBROUGHT);
    const r = await publishThroughGates(INPUT);
    expect(r).toEqual({ status: 428, body: { error: "ab_bring_pending", experimentId: "ab_promo0001", name: "Hero test", bringState: "conflict" } });
    expect(m.publishProject).not.toHaveBeenCalled();
    expect(m.gate).not.toHaveBeenCalled();
  });

  it("once they resolve it (nothing pending any more) the publish goes through", async () => {
    m.live.mockResolvedValue(null);
    m.unbrought.mockResolvedValue(null);
    expect((await publishThroughGates(INPUT)).status).toBe(200);
  });

  it("it is the PERSON's publish that waits: Len Watch's fix and the experiment's own promote are not held by it", async () => {
    m.live.mockResolvedValue(null);
    m.unbrought.mockResolvedValue(UNBROUGHT);
    expect((await publishThroughGates({ ...INPUT, source: "len_watch", sourcesFrom: "copy-9" })).status).toBe(200);
    expect(m.unbrought).not.toHaveBeenCalled();
  });

  it("with the flag off nothing about experiments is looked up", async () => {
    enabled.on = false;
    m.unbrought.mockResolvedValue(UNBROUGHT);
    expect((await publishThroughGates(INPUT)).status).toBe(200);
    expect(m.unbrought).not.toHaveBeenCalled();
  });
});

describe("the other doors", () => {
  it("🔴 Len Watch's publish (or any non-person) that meets a live experiment: 409 ab_experiment_running", async () => {
    m.publishProject.mockRejectedValueOnce(new AbExperimentRunningError("ab_1234abcd", "Direct hero", "/"));
    const r = await publishThroughGates({ ...INPUT, source: "len_watch", sourcesFrom: "copy-9" });
    expect(r).toEqual({ status: 409, body: { error: "ab_experiment_running", experimentId: "ab_1234abcd", name: "Direct hero", targetPath: "/" } });
    expect(m.live).not.toHaveBeenCalled(); // the 428 question is a person's; the door itself refuses
    expect(m.publishProject.mock.calls[0]![0]).not.toHaveProperty("abLive");
  });

  it("a person whose publish raced a launch is answered the same way (409)", async () => {
    m.live.mockResolvedValue(null);
    m.publishProject.mockRejectedValueOnce(new AbExperimentRunningError("ab_1234abcd", "Direct hero", "/"));
    expect((await publishThroughGates(INPUT)).status).toBe(409);
  });

  it("🔴 the experiment's own promote is `ending`: it must not be refused by the door", async () => {
    await publishThroughGates({ ...INPUT, source: "ab_promote", sourcesFrom: "copy-1" });
    expect(m.publishProject).toHaveBeenCalledWith(expect.objectContaining({ abLive: "ending" }));
    expect(m.endAfterPublish).not.toHaveBeenCalled(); // promote closes the row itself
  });
});

describe("when the A/B tables can't be read (G1+G3 review, item 22)", () => {
  it("🔴 a database error asking whether an experiment is live is a clean 503 with its own code, and nothing is published", async () => {
    m.live.mockRejectedValue(new Error("connection terminated"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await publishThroughGates(INPUT);
    error.mockRestore();
    expect(r).toEqual({ status: 503, body: { error: "ab_unavailable" } });
    expect(m.publishProject).not.toHaveBeenCalled();
    expect(m.gate).not.toHaveBeenCalled();
  });

  it("the same for the question about a promoted winner still to bring in", async () => {
    m.live.mockResolvedValue(null);
    m.unbrought.mockRejectedValue(new Error("connection terminated"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await publishThroughGates(INPUT);
    error.mockRestore();
    expect(r).toEqual({ status: 503, body: { error: "ab_unavailable" } });
    expect(m.publishProject).not.toHaveBeenCalled();
  });

  it("with the flag off the A/B tables are never asked, so their failure can't stop a publish", async () => {
    enabled.on = false;
    m.live.mockRejectedValue(new Error("connection terminated"));
    expect((await publishThroughGates(INPUT)).status).toBe(200);
  });
});
