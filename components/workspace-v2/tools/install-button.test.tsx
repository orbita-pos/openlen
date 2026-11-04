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
});
