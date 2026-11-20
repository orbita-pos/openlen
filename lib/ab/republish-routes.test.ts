// @vitest-environment node
// THE SYSTEM REPUBLISH DOORS KEEP A RUNNING EXPERIMENT ALIVE (review item 13): republish-all and the internal republish
// pass `abLive: "keep"`, so a platform-wide re-bake re-emits the live split (same Variant B, new Control) instead of
// writing a release without the manifest.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ publishProject: vi.fn(), rows: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/projects", () => ({ publishProject: m.publishProject }));
vi.mock("@/lib/auth/admin-only", () => ({ requireAdmin: async () => ({ ok: true }) }));
vi.mock("@/lib/publish/internal-auth", () => ({ internalSecretOk: () => true }));
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  db: { select: () => ({ from: () => ({ where: async () => m.rows }) }) },
}));

// Loaded once, up here: importing a route pulls half the app, and doing it inside a test timed out under load.
const internal = await import("@/app/api/internal/republish/route");
const all = await import("@/app/api/admin/republish-all/route");

beforeEach(() => {
  vi.clearAllMocks();
  m.rows = [{ id: "p1", userId: "u1", subdomain: "pan" }];
  m.publishProject.mockResolvedValue({ subdomain: "pan" });
});

describe("system republishes", () => {
  it("🔴 the internal republish keeps a live experiment (`abLive: keep`)", async () => {
    const res = await internal.POST(new Request("http://x/api/internal/republish", { method: "POST", body: JSON.stringify({ projectIds: ["p1"] }) }));
    expect(res.status).toBe(200);
    expect(m.publishProject).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", abLive: "keep" }));
  });

  it("🔴 republish-all keeps it too", async () => {
    const res = await all.POST();
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(m.publishProject).toHaveBeenCalled());
    expect(m.publishProject).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", abLive: "keep" }));
  });
});

describe("a project whose promoted winner isn't in the draft yet (review: the bring gate in the bottom door)", () => {
  it("🔴 the sweeps skip it, with the reason, instead of counting a failure", async () => {
    const { AbRepublishSkipped } = await import("@/lib/ab/errors");
    m.rows = [{ id: "p1", userId: "u1", subdomain: "pan" }, { id: "p2", userId: "u2", subdomain: "two" }];
    m.publishProject.mockRejectedValueOnce(new AbRepublishSkipped("bring_pending", "The winner of the A/B test \"Hero\" isn't in the draft yet"));
    const res = await all.POST();
    expect(res.status).toBe(202);
    await vi.waitFor(async () => {
      const state = await (await all.GET()).json();
      expect(state.running).toBe(false);
      expect(state.lastRun.skippedAb).toEqual(["pan"]);
      expect(state.lastRun).toMatchObject({ ok: 1, failed: 0 });
    });
  });
});
