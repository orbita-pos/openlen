// @vitest-environment node
// /api/projects/[id]/theme-install (spec local 2026-11-27-temas-del-workspace, §4.2): POST installs, DELETE removes. The
// install itself is `lib/themes/install.test.ts`'s; this is the route's part — the session, the body, the status.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/themes/install", () => ({ installTheme: vi.fn(), removeTheme: vi.fn() }));

const { auth } = await import("@/auth");
const { installTheme, removeTheme } = await import("@/lib/themes/install");
const { POST, DELETE } = await import("./route");

const ctx = { params: Promise.resolve({ id: "p1" }) };
const url = "http://localhost:3000/api/projects/p1/theme-install";
const post = (body: string) => POST(new Request(url, { method: "POST", body }), ctx);
const del = () => DELETE(new Request(url, { method: "DELETE" }), ctx);

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(installTheme).mockReset();
  vi.mocked(removeTheme).mockReset();
});

const signedIn = () => vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never);

describe("POST", () => {
  it("is a 401 without a session, and installs nothing", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const r = await post("{}");
    expect(r.status).toBe(401);
    expect(installTheme).not.toHaveBeenCalled();
  });

  it("installs for the person in the session, in the locale they sent, and answers with what install says", async () => {
    signedIn();
    vi.mocked(installTheme).mockResolvedValue({ status: 200, body: { themes: [] } });
    const r = await post(JSON.stringify({ locale: "es" }));
    expect(installTheme).toHaveBeenCalledWith({ projectId: "p1", actorId: "u1", locale: "es" });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ themes: [] });
  });

  it("takes an empty body as English, and passes a refusal's status through", async () => {
    signedIn();
    vi.mocked(installTheme).mockResolvedValue({ status: 403, body: { error: "owner_only" } });
    const r = await post("");
    expect(installTheme).toHaveBeenCalledWith({ projectId: "p1", actorId: "u1", locale: "en" });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "owner_only" });
  });

  it("is a 400 for a body that is not JSON, or not the shape", async () => {
    signedIn();
    expect((await post("{nope")).status).toBe(400);
    expect((await post(JSON.stringify({ locale: 7 }))).status).toBe(400);
    expect(installTheme).not.toHaveBeenCalled();
  });
});

describe("DELETE", () => {
  it("is a 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await del()).status).toBe(401);
    expect(removeTheme).not.toHaveBeenCalled();
  });

  it("removes the person's own installation of the project", async () => {
    signedIn();
    vi.mocked(removeTheme).mockResolvedValue({ status: 200, body: { removed: true } });
    const r = await del();
    expect(removeTheme).toHaveBeenCalledWith({ projectId: "p1", actorId: "u1" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ removed: true });
  });
});
