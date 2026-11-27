// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<{ user?: { id?: string } } | null> => ({ user: { id: "u1" } })),
  desktopWindow: vi.fn(),
  desktopIconResponse: vi.fn(async () => new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } })),
}));

vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/desktop-apps/page-state", () => ({ desktopWindow: m.desktopWindow }));
vi.mock("@/lib/desktop-apps/icon", () => ({ desktopIconResponse: m.desktopIconResponse }));

const { GET } = await import("./route");

const ROW = { id: "d1", name: "Bookings", iconPath: null, releaseSha: "sha1" };
const get = () => GET(new Request("https://openlen.com/desktop/d1/icon", { headers: { host: "openlen.com" } }), { params: Promise.resolve({ id: "d1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "u1" } });
  m.desktopWindow.mockResolvedValue({ state: { kind: "ready", name: "Bookings" }, row: ROW });
});

describe("GET /desktop/<id>/icon", () => {
  it("draws the icon of the person's own app", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(m.desktopIconResponse).toHaveBeenCalledWith(ROW);
    expect(m.desktopWindow).toHaveBeenCalledWith({ id: "d1", sessionUserId: "u1", requestHost: "openlen.com" });
  });

  it("a free plan still has its icon (its window opens, to say a paid plan is needed)", async () => {
    m.desktopWindow.mockResolvedValue({ state: { kind: "plan_required", name: "Bookings" }, row: ROW });
    expect((await get()).status).toBe(200);
  });

  it("🔴 404 for every other state — an icon is the first letter of a name, so another person's is as secret as its name", async () => {
    for (const state of [{ kind: "gone" }, { kind: "gone", name: "Bookings" }, { kind: "off" }, { kind: "sign_in" }]) {
      m.desktopWindow.mockResolvedValue({ state, row: null });
      const res = await get();
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(m.desktopIconResponse).not.toHaveBeenCalled();
  });
});
