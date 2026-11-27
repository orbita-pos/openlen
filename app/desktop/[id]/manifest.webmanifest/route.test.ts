// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<{ user?: { id?: string } } | null> => ({ user: { id: "u1" } })),
  desktopWindow: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/desktop-apps/page-state", () => ({ desktopWindow: m.desktopWindow }));

const { GET } = await import("./route");

const ID = "0b6f1c1e-8f4d-4a52-9b0e-2f7f6a1d3c55";
const ROW = { id: ID, name: "Bookings", iconPath: null, releaseSha: "sha1" };
const get = (id = ID, headers: Record<string, string> = { host: "openlen.com" }) =>
  GET(new Request(`https://openlen.com/desktop/${id}/manifest.webmanifest`, { headers }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "u1" } });
  m.desktopWindow.mockResolvedValue({ state: { kind: "ready", name: "Bookings" }, row: ROW });
});

describe("GET /desktop/<id>/manifest.webmanifest", () => {
  it("id, scope and start_url are /desktop/<id> without trailing slash", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(`/desktop/${ID}`);
    expect(body.scope).toBe(`/desktop/${ID}`);
    expect(body.start_url).toBe(`/desktop/${ID}`);
    expect(body.display).toBe("standalone");
    expect(body.name).toBe("Bookings");
    expect(body.icons[0].src).toBe(`/desktop/${ID}/icon`);
  });

  it("is a manifest, and never cached", async () => {
    const res = await get();
    expect(res.headers.get("content-type")).toBe("application/manifest+json");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("it asks the same question the page asks: this id, this session, this host", async () => {
    await get(ID, { host: "localhost:3007" });
    expect(m.desktopWindow).toHaveBeenCalledWith({ id: ID, sessionUserId: "u1", requestHost: "localhost:3007" });
  });

  it("404 when gone — and it does not say the app was ever there", async () => {
    m.desktopWindow.mockResolvedValue({ state: { kind: "gone", name: "Bookings" }, row: null });
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Bookings");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("404 when off or signed out", async () => {
    for (const kind of ["off", "sign_in"]) {
      m.desktopWindow.mockResolvedValue({ state: { kind }, row: null });
      expect((await get()).status).toBe(404);
    }
    m.auth.mockResolvedValue(null);
    await get();
    expect(m.desktopWindow).toHaveBeenLastCalledWith(expect.objectContaining({ sessionUserId: null }));
  });

  it("a free plan still has a manifest: the installed window opens to say a paid plan is needed", async () => {
    m.desktopWindow.mockResolvedValue({ state: { kind: "plan_required", name: "Bookings" }, row: ROW });
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("Bookings");
  });

  it("a tool's own icon says its type", async () => {
    m.desktopWindow.mockResolvedValue({ state: { kind: "ready", name: "T" }, row: { ...ROW, iconPath: "/icon.png" } });
    expect((await (await get()).json()).icons[0].type).toBe("image/png");
  });
});
