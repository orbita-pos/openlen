// THE ENTRIES OF THE MENU (spec local 2026-11-26-apps-en-el-escritorio, §4.1, §4.6): «Instalar en el escritorio», «Actualizar en el
// escritorio» only when there is something to update (otherwise «Abrir en el escritorio»), and «Quitar del escritorio». What is
// installed, and whether it CAN be, is read from the route, which answers a 404 to anyone who isn't the owner and when the
// switch is off: both leave the menu without them. A refusal the route knows beforehand (the plan, Stripe, the tool) is shown
// before any tap — disabled, with its reason under it — as Claude offers install only where it can work.
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
const state = (over: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ desktopApp: null, updateAvailable: false, published: false, canInstall: true, blockedBy: null, ...over }));
const blocked = (blockedBy: string, over: Record<string, unknown> = {}) => state({ canInstall: false, blockedBy, ...over });

async function render() {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root!.render(<DesktopMenuItems projectId="p1" title="Reservas" />));
}
const entry = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
const openLink = () => [...document.querySelectorAll("a")].find((a) => a.textContent?.includes("desktopInstall.menu.open"));

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

  it("installed with something new: offers «Actualizar en el escritorio» and «Quitar del escritorio», not «Instalar» and not «Abrir»", async () => {
    fetchMock.mockResolvedValue(state({ desktopApp: DESKTOP_APP, updateAvailable: true }));
    await render();
    expect(entry("desktopInstall.menu.update")).toBeDefined();
    expect(entry("desktopInstall.menu.remove")).toBeDefined();
    expect(entry("desktopInstall.menu.install")).toBeUndefined();
    expect(openLink()).toBeUndefined();
    expect(document.body.textContent).toContain("desktopInstall.menu.updateAvailable");
  });

  // M24 — Claude has no «update» action when nothing changed: with nothing new, the entry opens the window.
  it("🔴 installed and up to date: no «Actualizar» — «Abrir en el escritorio» opens the window, and says it is up to date", async () => {
    fetchMock.mockResolvedValue(state({ desktopApp: DESKTOP_APP, updateAvailable: false }));
    await render();
    expect(entry("desktopInstall.menu.update")).toBeUndefined();
    expect(entry("desktopInstall.menu.install")).toBeUndefined();
    const open = openLink()!;
    expect(open).toBeDefined();
    expect(open.getAttribute("href")).toBe("/desktop/d1");
    expect(open.target).toBe("_blank");
    expect(open.rel).toContain("noopener");
    expect(open.textContent).toContain("desktopInstall.menu.upToDate");
    expect(document.body.textContent).not.toContain("desktopInstall.menu.updateAvailable");
    // «Quitar» is still there.
    expect(entry("desktopInstall.menu.remove")).toBeDefined();
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
    expect(openLink()).toBeUndefined();
  });

  it("Quitar deletes this installation's granted rows and keeps denied", async () => {
    localStorage.setItem(
      "openlen:desktop-permissions",
      JSON.stringify({
        "u1|d1|notifications": { answer: "granted", releaseSha: "abc123", installedAt: DESKTOP_APP.installedAt },
        "u1|d1|shortcuts": { answer: "denied" },
        "u1|d2|notifications": { answer: "granted", releaseSha: "x", installedAt: DESKTOP_APP.installedAt },
      }),
    );
    fetchMock.mockResolvedValueOnce(state({ desktopApp: DESKTOP_APP }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ removed: true })));
    fetchMock.mockResolvedValueOnce(state());
    await render();
    await act(async () => entry("desktopInstall.menu.remove")!.click());
    expect(JSON.parse(localStorage.getItem("openlen:desktop-permissions")!)).toEqual({
      "u1|d1|shortcuts": { answer: "denied" },
      "u1|d2|notifications": { answer: "granted", releaseSha: "x", installedAt: DESKTOP_APP.installedAt },
    });
    localStorage.clear();
  });

  it("a removal that fails keeps the answers", async () => {
    const answers = JSON.stringify({ "u1|d1|notifications": { answer: "granted", releaseSha: "abc123", installedAt: DESKTOP_APP.installedAt } });
    localStorage.setItem("openlen:desktop-permissions", answers);
    fetchMock.mockResolvedValueOnce(state({ desktopApp: DESKTOP_APP }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    await render();
    await act(async () => entry("desktopInstall.menu.remove")!.click());
    expect(localStorage.getItem("openlen:desktop-permissions")).toBe(answers);
    localStorage.clear();
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

  it("a route that doesn't say whether it can (an older answer) is read as «it can»", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ desktopApp: null, updateAvailable: false, published: false })));
    await render();
    expect((entry("desktopInstall.menu.install") as HTMLButtonElement).disabled).toBe(false);
  });
});

// M21 — Claude hides install where it can't work; OpenLen shows it, disabled, with the reason under it BEFORE any tap.
describe("DesktopMenuItems — what the route knows can't be done", () => {
  it.each([
    ["plan_required", "desktopInstall.menu.blocked.plan_required"],
    ["uses_stripe", "desktopInstall.menu.blocked.uses_stripe"],
    ["tool_not_installed", "desktopInstall.menu.blocked.tool_not_installed"],
    ["not_an_app", "desktopInstall.menu.blocked.not_an_app"],
  ] as const)("🔴 %s: «Instalar» is there, disabled, with its reason under it — and a tap does nothing", async (blockedBy, reason) => {
    fetchMock.mockResolvedValue(blocked(blockedBy));
    await render();
    const install = entry("desktopInstall.menu.install") as HTMLButtonElement;
    expect(install).toBeDefined();
    expect(install.disabled).toBe(true);
    expect(install.textContent).toContain(reason);
    // The standing subtitle is replaced by the reason, not kept beside it.
    expect(install.textContent).not.toContain("desktopInstall.menu.installSubtitle");
    await act(async () => install.click());
    expect(document.querySelector("[data-install-card]")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(entry("desktopInstall.menu.remove")).toBeUndefined();
  });

  it("installed, with something new, but it can't be updated now (the plan lapsed): «Actualizar» is disabled with the reason; «Quitar» still works", async () => {
    fetchMock.mockResolvedValue(blocked("plan_required", { desktopApp: DESKTOP_APP, updateAvailable: true }));
    await render();
    const update = entry("desktopInstall.menu.update") as HTMLButtonElement;
    expect(update.disabled).toBe(true);
    expect(update.textContent).toContain("desktopInstall.menu.blocked.plan_required");
    await act(async () => update.click());
    expect(document.querySelector("[data-install-card]")).toBeNull();
    expect((entry("desktopInstall.menu.remove") as HTMLButtonElement).disabled).toBe(false);
  });

  it("installed and up to date, with the plan lapsed: the window can still be opened (it says what is needed)", async () => {
    fetchMock.mockResolvedValue(blocked("plan_required", { desktopApp: DESKTOP_APP, updateAvailable: false }));
    await render();
    expect(openLink()).toBeDefined();
    expect(openLink()!.getAttribute("href")).toBe("/desktop/d1");
    expect(entry("desktopInstall.menu.update")).toBeUndefined();
  });

  it("an answer that can't be installed but names nothing is not a block: the entry stays as it was", async () => {
    fetchMock.mockResolvedValue(state({ canInstall: false, blockedBy: "something_new" }));
    await render();
    expect((entry("desktopInstall.menu.install") as HTMLButtonElement).disabled).toBe(false);
  });
});
