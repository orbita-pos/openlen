// @vitest-environment node
//
// WHAT THE PAGE ASKS OF THE REQUEST (spec local 2026-11-27-notificaciones-del-escritorio, §4.1): the page is the one caller that
// wants what the installed app declares, so it is the one that asks for it. The manifest and icon routes call `desktopWindow`
// on their own, without it, and never read the release.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  desktopWindow: vi.fn(),
  headers: new Map<string, string>([["host", "openlen.com"]]),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: (name: string) => m.headers.get(name) ?? null }),
}));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("./page-state", () => ({ desktopWindow: m.desktopWindow }));

const { desktopRequest } = await import("./page-request");

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "u1", name: "Ana" } });
  m.desktopWindow.mockResolvedValue({ state: { kind: "ready", name: "Bookings" }, row: null });
});

describe("desktopRequest", () => {
  it("asks for the window WITH what the app declares — only the page reads the release", async () => {
    const result = await desktopRequest("d1");
    expect(m.desktopWindow).toHaveBeenCalledWith({ id: "d1", sessionUserId: "u1", requestHost: "openlen.com", withDeclaredPermissions: true });
    expect(result).toEqual({ state: { kind: "ready", name: "Bookings" }, personName: "Ana" });
  });

  it("with no session it asks with no person, and still opts in (the state is `sign_in` before anything is read)", async () => {
    m.auth.mockResolvedValue(null);
    await desktopRequest("d2");
    expect(m.desktopWindow).toHaveBeenCalledWith({ id: "d2", sessionUserId: null, requestHost: "openlen.com", withDeclaredPermissions: true });
  });
});
