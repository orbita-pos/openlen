// THE ENTRIES OF THE MENU (spec local 2026-11-26-apps-en-el-escritorio, §4.1, §4.6): «Instalar en el escritorio» or
// «Actualizar en el escritorio», and «Quitar del escritorio». What is installed is read from the route, which answers a
// 404 to anyone who isn't the owner and when the switch is off: both leave the menu without them.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
  useLocale: () => "es",
}));

import { DesktopMenuItems } from "./desktop-menu-items";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DESKTOP_APP = { id: "d1", url: "/desktop/d1", name: "Reservas", releaseSha: "abc123", installedAt: "2026-11-26T10:00:00.000Z" };
const state = (over: Record<string, unknown> = {}) => new Response(JSON.stringify({ desktopApp: null, updateAvailable: false, published: false, ...over }));

async function render() {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root!.render(<DesktopMenuItems projectId="p1" title="Reservas" />));
}
const entry = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

describe("DesktopMenuItems", () => {
  it("reads the state from the route for this project", async () => {
    fetchMock.mockResolvedValue(state());
    await render();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/projects/p1/desktop");
    expect(fetchMock.mock.calls[0]![1]?.method ?? "GET").toBe("GET");
  });

  it("not installed: offers «Instalar en el escritorio», and a tap opens the card without installing", async () => {
    fetchMock.mockResolvedValue(state({ published: true }));
    await render();
    expect(entry("desktopInstall.menu.install")).toBeDefined();
    expect(entry("desktopInstall.menu.remove")).toBeUndefined();
    await act(async () => entry("desktopInstall.menu.install")!.click());
    expect(document.querySelector("[data-install-card]")?.getAttribute("data-install-card")).toBe("idle");
    // The shared-data notice comes from the route's own `published`.
    expect(document.body.textContent).toContain("desktopInstall.sharedWithSite");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("installed: offers «Actualizar en el escritorio» and «Quitar del escritorio», not «Instalar»", async () => {
    fetchMock.mockResolvedValue(state({ desktopApp: DESKTOP_APP, updateAvailable: true }));
    await render();
    expect(entry("desktopInstall.menu.update")).toBeDefined();
    expect(entry("desktopInstall.menu.remove")).toBeDefined();
    expect(entry("desktopInstall.menu.install")).toBeUndefined();
    expect(document.body.textContent).toContain("desktopInstall.menu.updateAvailable");
  });

  it("installed and up to date: the update entry says so", async () => {
    fetchMock.mockResolvedValue(state({ desktopApp: DESKTOP_APP, updateAvailable: false }));
    await render();
    expect(document.body.textContent).toContain("desktopInstall.menu.upToDate");
    expect(document.body.textContent).not.toContain("desktopInstall.menu.updateAvailable");
  });

  it("a tap on «Actualizar» opens the card as an update", async () => {
    fetchMock.mockResolvedValue(state({ desktopApp: DESKTOP_APP, updateAvailable: true }));
    await render();
    await act(async () => entry("desktopInstall.menu.update")!.click());
    expect(document.body.textContent).toContain('desktopInstall.updateTitle {"title":"Reservas"}');
  });

  it("«Quitar del escritorio» deletes, then reads the state again", async () => {
    fetchMock.mockResolvedValueOnce(state({ desktopApp: DESKTOP_APP }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ removed: true })));
    fetchMock.mockResolvedValueOnce(state());
    await render();
    await act(async () => entry("desktopInstall.menu.remove")!.click());
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/projects/p1/desktop");
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: "DELETE" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(entry("desktopInstall.menu.install")).toBeDefined();
    expect(entry("desktopInstall.menu.remove")).toBeUndefined();
  });

  it("a removal that fails says so and leaves the entries as they were", async () => {
    fetchMock.mockResolvedValueOnce(state({ desktopApp: DESKTOP_APP }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    await render();
    await act(async () => entry("desktopInstall.menu.remove")!.click());
    expect(document.body.textContent).toContain("desktopInstall.menu.removeFailed");
    expect(entry("desktopInstall.menu.remove")).toBeDefined();
  });

  it("a 404 (not the owner, or the switch is off) leaves nothing in the menu", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "desktop_apps_off" }), { status: 404 }));
    await render();
    expect(document.body.textContent).toBe("");
  });

  it("a route that doesn't answer leaves nothing in the menu", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await render();
    expect(document.body.textContent).toBe("");
  });
});
