// @vitest-environment node
// GET /api/projects/[id]/ab (review item 28): the visitors' numbers are the owner's and an editor's, a reader gets the list
// without them; and a request serves the stored snapshot while it is fresh instead of recomputing and writing every time.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: "dueno" as "dueno" | "editor" | "lector",
  rows: [] as unknown[],
  compute: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/projects/acceso", () => ({
  exigirAcceso: async () => ({ rol: m.role, duenoId: "owner" }),
  puede: (rol: string, permiso: string) => permiso === "ver" || rol !== "lector",
}));
vi.mock("@/lib/ab/enabled", () => ({ abTestingEnabled: () => true }));
vi.mock("@/lib/ab/lifecycle", () => ({ AbLifecycleError: class extends Error {}, createAbDraft: vi.fn() }));
vi.mock("@/lib/ab/metrics", () => ({
  computeExperimentMetrics: m.compute,
  metricsInputOf: (row: { id: string }) => ({ experimentId: row.id }),
}));
vi.mock("@/lib/ab/store", () => ({
  listExperimentsForProject: async () => m.rows,
  saveEvaluation: m.save,
  updateExperiment: m.update,
  toExperimentView: (row: Record<string, unknown>) => ({ id: row.id, status: row.status, metrics: row.metricsSnapshot ?? null, evaluatedAt: row.evaluatedAt ?? null }),
}));

const { GET } = await import("./route");

const NOW = Date.now();
const SNAP = { a: { views: 10, clicks: 1, conversions: 1, rate: 0.1 }, b: { views: 10, clicks: 1, conversions: 2, rate: 0.2 }, stats: { verdict: "collecting" }, computedAt: "x" };
const FRESH = { metricsSnapshot: SNAP, evaluatedAt: new Date(NOW - 60_000) };
const STALE = { metricsSnapshot: SNAP, evaluatedAt: new Date(NOW - 6 * 60_000) };

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  projectId: "p1",
  status: "running",
  startedAt: new Date(NOW - 86_400_000),
  metricsSnapshot: null,
  evaluatedAt: null,
  ...over,
});
const get = async () =>
  (await (await GET(new Request("https://openlen.com/api/projects/p1/ab"), { params: Promise.resolve({ id: "p1" }) })).json()) as {
    experiments: { id: string; metrics: unknown }[];
  };

beforeEach(() => {
  vi.clearAllMocks();
  m.role = "dueno";
  m.rows = [];
  m.compute.mockResolvedValue({ ...SNAP, computedAt: "fresh" });
  m.save.mockResolvedValue(true);
});

describe("who sees the visitors' numbers", () => {
  it("🔴 a reader gets the list of tests WITHOUT metrics — and nothing is computed or written for them", async () => {
    m.role = "lector";
    m.rows = [row("ab_1", FRESH), row("ab_2", { status: "winner_ready", ...STALE }), row("ab_3")];
    const body = await get();
    expect(body.experiments.map((e) => e.id)).toEqual(["ab_1", "ab_2", "ab_3"]);
    expect(body.experiments.every((e) => e.metrics === null)).toBe(true);
    expect(m.compute).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
  });

  it("an editor and the owner see them", async () => {
    for (const role of ["editor", "dueno"] as const) {
      m.role = role;
      m.rows = [row("ab_1", FRESH)];
      expect((await get()).experiments[0]!.metrics).toEqual(SNAP);
    }
  });
});

describe("the stored snapshot", () => {
  it("🔴 younger than five minutes: it is served as it is — nothing recomputed, nothing written", async () => {
    m.rows = [row("ab_1", FRESH)];
    const body = await get();
    expect(body.experiments[0]!.metrics).toEqual(SNAP);
    expect(m.compute).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("🔴 older than five minutes (or none yet): recomputed once, and saved with the evaluator's compare-and-swap, never a plain update", async () => {
    m.rows = [row("ab_1", STALE), row("ab_2")];
    const body = await get();
    expect(m.compute).toHaveBeenCalledTimes(2);
    expect(m.save).toHaveBeenCalledTimes(2);
    expect(m.save.mock.calls[0]![0]).toBe("ab_1");
    expect(m.update).not.toHaveBeenCalled();
    expect((body.experiments[0]!.metrics as { computedAt: string }).computedAt).toBe("fresh");
  });

  it("only a RUNNING experiment is recomputed; one that ended keeps what it had", async () => {
    m.rows = [row("ab_1", { status: "winner_ready", ...STALE })];
    await get();
    expect(m.compute).not.toHaveBeenCalled();
  });

  it("a compute that fails serves the stored view, not a 500", async () => {
    m.rows = [row("ab_1", STALE)];
    m.compute.mockRejectedValue(new Error("db"));
    const body = await get();
    expect(body.experiments[0]!.metrics).toEqual(SNAP);
  });
});
