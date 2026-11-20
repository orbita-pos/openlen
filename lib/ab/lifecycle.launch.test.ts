// @vitest-environment node
// LAUNCHING AN EXPERIMENT (review items 12 and 15).
//
// · 12 — the draft was cut from the published version of that day. If the site was published since, Variant B is built on
//   a base that no longer is the site: promoting it, or «keeping A», would undo that publication. The launch refuses
//   (409 `base_moved`) and publishes nothing; and Control's release to fall back on is always the one live AT LAUNCH.
// · 15 — one experiment per project is live at a time (the manifest carries one): a second launch is refused.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  exp: null as Record<string, unknown> | null,
  live: null as Record<string, unknown> | null,
  project: null as Record<string, unknown> | null,
  published: null as Record<string, unknown> | null,
  publishProject: vi.fn(),
  runSecurityGate: vi.fn(),
  updateExperiment: vi.fn(),
  commitAbWorktree: vi.fn(),
  purge: vi.fn(),
}));

vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => (h.project ? [h.project] : []) }) }) }) },
}));
vi.mock("@/lib/assistants/store", () => ({ assistantOfProject: async () => null }));
vi.mock("@/lib/assistants/enabled", () => ({ assistantsEnabled: () => false }));
vi.mock("@/lib/ab/enabled", () => ({ abTestingEnabled: () => true }));
vi.mock("@/lib/len-watch/published-sources", () => ({ readPublishedSources: async () => h.published }));
vi.mock("@/lib/projects", () => ({ publishProject: h.publishProject }));
vi.mock("@/lib/projects/publish-through-gates", () => ({ runSecurityGate: h.runSecurityGate, publishThroughGates: vi.fn() }));
vi.mock("@/lib/publish/cache-purge", () => ({ purgeSubdomain: h.purge }));
vi.mock("@/lib/publish/filesystem", () => ({ rollbackToSha: vi.fn() }));
vi.mock("@/lib/ab/store", () => ({
  getExperimentById: async () => h.exp,
  liveExperimentForProject: async () => h.live,
  activeExperimentForTarget: async () => null,
  createExperimentRow: vi.fn(),
  claimExperimentDecision: vi.fn(),
  releaseDecisionLock: vi.fn(),
  updateExperiment: h.updateExperiment,
  claimLaunch: async () => ({ ...h.exp, status: "running" }),
  releaseLaunch: vi.fn(),
  toExperimentView: (row: unknown) => row,
  normalizePrimaryMetric: (m: unknown) => m,
  normalizeTargetPath: (p: unknown) => p,
}));
vi.mock("@/lib/ab/worktree", () => ({
  cleanupAbWorktree: vi.fn(),
  commitAbWorktree: h.commitAbWorktree,
  copySources: async () => ({ data: { html: "<html>B</html>", pages: {} }, folder: { "/css/a.css": "b{}" } }),
  createAbWorktree: vi.fn(),
  ensurePublishedSources: async () => h.published,
  mergeWinnerIntoDraft: vi.fn(),
  readPublishedFolder: async () => ({ "/css/a.css": "a{}" }),
}));

const { AbLifecycleError, launchAbExperiment } = await import("./lifecycle");

const launch = () => launchAbExperiment({ projectId: "p1", experimentId: "ab_aaaa1111", ownerId: "owner", actorId: "owner" });

beforeEach(() => {
  vi.clearAllMocks();
  h.exp = {
    id: "ab_aaaa1111",
    projectId: "p1",
    status: "draft",
    copyProjectId: "copy-1",
    targetPath: "/",
    splitBps: 5000,
    salt: "salt",
    includeLocales: false,
    baseCommitOid: "base-1",
    // What was live when the draft was cut: the same release as now (nothing was published since).
    controlReleaseSha: "release-live-now",
  };
  h.live = null;
  h.project = { title: "Panadería", subdomain: "pan", publishedReleaseSha: "release-live-now", data: { html: "<html>A</html>" } };
  h.published = { commitOid: "base-1", data: { html: "<html>A</html>" }, extraFiles: {} };
  h.runSecurityGate.mockResolvedValue({ fingerprint: null });
  h.commitAbWorktree.mockResolvedValue("tip-1");
  h.purge.mockResolvedValue(undefined);
  h.publishProject.mockResolvedValue({ sha: "release-experiment" });
  h.updateExperiment.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({ ...h.exp, ...patch }));
});

describe("launch re-baselines (item 12)", () => {
  it("🔴 the site was published between the draft and the launch: 409 base_moved, and NOTHING is published", async () => {
    h.published = { commitOid: "base-2-published-since", data: { html: "<html>A2</html>" }, extraFiles: {} };
    const err = await launch().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AbLifecycleError);
    expect(err).toMatchObject({ code: "base_moved", status: 409 });
    expect((err as Error).message).toMatch(/published since/i);
    expect(h.publishProject).not.toHaveBeenCalled();
    expect(h.runSecurityGate).not.toHaveBeenCalled();
    expect(h.commitAbWorktree).not.toHaveBeenCalled();
    // the only write is the stale draft's cancellation (item 16: it must not stay alive as «active»)
    expect(h.updateExperiment).toHaveBeenCalledTimes(1);
    expect(h.updateExperiment.mock.calls[0]![1]).toMatchObject({ status: "cancelled" });
  });

  it("an experiment with no recorded base can't be proven to match: it is refused the same way", async () => {
    h.exp = { ...h.exp, baseCommitOid: null };
    await expect(launch()).rejects.toMatchObject({ code: "base_moved", status: 409 });
    expect(h.publishProject).not.toHaveBeenCalled();
  });

  it("🔴 no publish since the draft: it launches, and Control's fallback release is the one live NOW — never the stored one", async () => {
    await launch();
    expect(h.publishProject).toHaveBeenCalledTimes(1);
    const call = h.publishProject.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.protectReleaseShas).toEqual(["release-live-now"]);
    expect(call.sourcesOverride).toMatchObject({ data: { html: "<html>A</html>" } });
    expect(call.abExperiment).toMatchObject({ id: "ab_aaaa1111", targetPath: "/", variantB: { html: "<html>B</html>" } });
    const patch = h.updateExperiment.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(patch.controlReleaseSha).toBe("release-live-now");
    expect(patch.status).toBe("running");
    expect(patch.experimentReleaseSha).toBe("release-experiment");
  });
});

describe("one live experiment per project (item 15)", () => {
  it("🔴 another experiment of the project is live: 409 ab_already_running, nothing is published", async () => {
    h.live = { id: "ab_bbbb2222", status: "running", name: "Other test" };
    const err = await launch().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AbLifecycleError);
    expect(err).toMatchObject({ code: "ab_already_running", status: 409 });
    expect((err as InstanceType<typeof AbLifecycleError>).extra).toMatchObject({ runningExperimentId: "ab_bbbb2222" });
    expect(h.publishProject).not.toHaveBeenCalled();
    expect(h.runSecurityGate).not.toHaveBeenCalled();
  });

  it("nothing else live: it launches", async () => {
    h.live = null;
    await expect(launch()).resolves.toBeDefined();
  });
});
