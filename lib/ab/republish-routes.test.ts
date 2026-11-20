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

beforeEach(() => {
  vi.clearAllMocks();
  m.rows = [{ id: "p1", userId: "u1", subdomain: "pan" }];
  m.publishProject.mockResolvedValue({ subdomain: "pan" });
});

describe("system republishes", () => {
  it("🔴 the internal republish keeps a live experiment (`abLive: keep`)", async () => {
    const { POST } = await import("@/app/api/internal/republish/route");
    const res = await POST(new Request("http://x/api/internal/republish", { method: "POST", body: JSON.stringify({ projectIds: ["p1"] }) }));
    expect(res.status).toBe(200);
    expect(m.publishProject).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", abLive: "keep" }));
  });

  it("🔴 republish-all keeps it too", async () => {
    const { POST } = await import("@/app/api/admin/republish-all/route");
    const res = await POST();
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(m.publishProject).toHaveBeenCalled());
    expect(m.publishProject).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", abLive: "keep" }));
  });
});
