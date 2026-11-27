// @vitest-environment node
//
// THE PAGE OF AN APP ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio, §4.3, §4.6, §6): the state decides what it is.
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  desktopRequest: vi.fn(),
  requestLocale: vi.fn(async () => "es"),
  redirect: vi.fn((to: string): never => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: m.redirect, notFound: m.notFound }));
vi.mock("@/lib/desktop-apps/page-request", () => ({ desktopRequest: m.desktopRequest, requestLocale: m.requestLocale }));
vi.mock("@/components/desktop-apps/desktop-window", () => ({ DesktopWindow: function DesktopWindow() { return null; } }));
vi.mock("@/components/desktop-apps/desktop-notice", () => ({ DesktopNotice: function DesktopNotice() { return null; } }));

const { default: DesktopPage, generateMetadata } = await import("./page");

const ID = "0b6f1c1e-8f4d-4a52-9b0e-2f7f6a1d3c55";
const READY = {
  kind: "ready" as const,
  name: "Bookings",
  frameUrl: "https://lienzo-x.openlen.app/?v=sha1",
  frameOrigin: "https://lienzo-x.openlen.app",
  projectId: "p1",
  releaseSha: "sha1",
  toolInstallationId: null,
  installedAt: "2026-11-20T12:00:00.000Z",
};
const open = () => DesktopPage({ params: Promise.resolve({ id: ID }) });
const meta = () => generateMetadata({ params: Promise.resolve({ id: ID }) });
const asked = (state: unknown) => m.desktopRequest.mockResolvedValue({ state, personName: "Ana" });

/** The window inside the provider the page wraps it in. */
function inner(el: ReactElement): ReactElement {
  return (el.props as { children: ReactElement }).children;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.requestLocale.mockResolvedValue("es");
  asked(READY);
});

describe("the page", () => {
  it("the switch off is a 404", async () => {
    asked({ kind: "off" });
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("signed out goes to the login, which comes back here — outside the locale segment", async () => {
    asked({ kind: "sign_in" });
    await expect(open()).rejects.toThrow(`NEXT_REDIRECT /es/login?next=${encodeURIComponent(`/desktop/${ID}`)}`);
  });

  it("ready is the window, with the app's own facts and the person's language", async () => {
    const el = await open();
    expect(el.props).toMatchObject({ locale: "es" });
    const win = inner(el);
    expect((win.type as { name: string }).name).toBe("DesktopWindow");
    expect(win.props).toEqual({
      name: "Bookings",
      frameUrl: READY.frameUrl,
      frameOrigin: READY.frameOrigin,
      projectId: "p1",
      releaseSha: "sha1",
      toolInstallationId: null,
      installedAt: READY.installedAt,
      locale: "es",
      personName: "Ana",
    });
  });

  it("only the window's own texts travel to the browser, in the person's language", async () => {
    const el = await open();
    const messages = el.props.messages as { wsChrome: Record<string, unknown> };
    expect(Object.keys(messages)).toEqual(["wsChrome"]);
    expect(Object.keys(messages.wsChrome)).toEqual(["desktop"]);
    expect(JSON.stringify(messages.wsChrome.desktop)).toContain("Acerca de");
  });

  it("gone and plan_required are the notice, with no frame", async () => {
    asked({ kind: "gone", name: "Bookings" });
    let win = inner(await open());
    expect((win.type as { name: string }).name).toBe("DesktopNotice");
    expect(win.props).toEqual({ kind: "gone", name: "Bookings", locale: "es" });
    asked({ kind: "gone" });
    win = inner(await open());
    expect(win.props).toEqual({ kind: "gone", name: undefined, locale: "es" });
    asked({ kind: "plan_required", name: "Bookings" });
    win = inner(await open());
    expect(win.props).toEqual({ kind: "plan_required", name: "Bookings", locale: "es" });
  });
});

describe("the page's metadata", () => {
  it("the tab is the app's name; OpenLen's own manifest is switched off for this window (its link is the layout's), and the icon is the window's", async () => {
    expect(await meta()).toMatchObject({
      title: "Bookings",
      manifest: null,
      robots: { index: false },
      icons: { icon: [{ url: `/desktop/${ID}/icon`, sizes: "any" }] },
    });
  });

  it("🔴 a gone app that isn't the person's gives away no name and no icon", async () => {
    asked({ kind: "gone" });
    const metadata = await meta();
    expect(metadata.title).toBe("OpenLen");
    expect(JSON.stringify(metadata)).not.toContain("/icon");
    expect(metadata.manifest).toBeNull();
  });

  it("a free plan keeps its name and icon (the installed window opens to say a paid plan is needed)", async () => {
    asked({ kind: "plan_required", name: "Bookings" });
    expect(await meta()).toMatchObject({ title: "Bookings", icons: { icon: [{ url: `/desktop/${ID}/icon` }] } });
  });
});
