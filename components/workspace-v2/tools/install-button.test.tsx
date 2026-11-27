// «INSTALAR» IN THE TOP BAR (spec local 2026-11-04-herramientas-hechas-por-len, §4.2): in a tool project installing
// takes publishing's place — the bar's coral button says «Instalar» and opens the same card Len's `publish` leaves.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
  useLocale: () => "es",
}));

import { ToolInstallButton } from "./install-button";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ToolInstallButton", () => {
  it("says «Instalar»; a tap opens the install card for this project, without installing yet", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root!.render(<ToolInstallButton projectId="p1" title="Reservas" />));
    const bar = document.querySelector<HTMLButtonElement>("button[data-tool-install]")!;
    expect(bar.textContent).toContain("installCard.install");
    expect(document.querySelector("[data-install-card]")).toBeNull();
    await act(async () => bar.click());
    expect(document.querySelector("[data-install-card]")?.getAttribute("data-install-card")).toBe("idle");
    expect(document.body.textContent).toContain('installCard.title {"title":"Reservas"}');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  // The tool also goes on the desktop (spec local 2026-11-26-apps-en-el-escritorio, §4.3): the owner's menu carries the entry.
  it("with `desktop`, the open menu offers the tool on the desktop beside its own install", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ desktopApp: null, updateAvailable: false, published: false })));
    vi.stubGlobal("fetch", fetchMock);
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root!.render(<ToolInstallButton projectId="p1" title="Reservas" desktop />));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => document.querySelector<HTMLButtonElement>("button[data-tool-install]")!.click());
    expect(fetchMock.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["/api/projects/p1/desktop"]);
    expect(document.querySelector("[data-install-card]")).not.toBeNull();
    expect(document.body.textContent).toContain("desktopInstall.menu.install");
    vi.unstubAllGlobals();
  });

  it("with `desktop` but nothing from the route (not the owner, or the switch is off), the menu is the tool's alone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 })));
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root!.render(<ToolInstallButton projectId="p1" title="Reservas" desktop />));
    await act(async () => document.querySelector<HTMLButtonElement>("button[data-tool-install]")!.click());
    expect(document.body.textContent).not.toContain("desktopInstall.menu");
    expect(document.querySelector("[data-desktop-menu]")).toBeNull();
    vi.unstubAllGlobals();
  });
});
