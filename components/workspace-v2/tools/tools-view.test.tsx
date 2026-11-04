// THE HERRAMIENTAS PAGE (spec local 2026-11-04-herramientas-hechas-por-len, §4.11): DeepSeek's Plugins page — each
// installed tool with its switch, its project, Quitar or Restaurar; and «Pedir a Len una herramienta».
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useLocale: () => "es" }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

import type { InstalledToolView } from "@/lib/tools/types";

import { ToolsView } from "./tools-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tool = (over: Partial<InstalledToolView> = {}): InstalledToolView => ({
  id: "i1",
  projectId: "p1",
  title: "Reservas de hoy",
  description: "Ver y confirmar",
  placement: "rail",
  iconUrl: "/api/tools/i1/icon?v=1",
  frameUrl: "http://x/?v=1",
  frameOrigin: "http://x",
  releaseSha: "1",
  enabled: true,
  installedAt: "2026-11-04T10:00:00.000Z",
  status: "ok",
  ...over,
});

let root: Root | null = null;
const fetchMock = vi.fn();
beforeEach(() => {
  nav.push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render(tools: InstalledToolView[], paid = true) {
  const reload = vi.fn();
  const div = document.createElement("div");
  document.body.appendChild(div);
  root = createRoot(div);
  await act(async () => root!.render(<ToolsView tools={tools} paid={paid} onChanged={reload} />));
  return reload;
}
const byText = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;

describe("ToolsView", () => {
  it("each tool with its switch; switching it off PATCHes", async () => {
    const reload = await render([tool()]);
    const sw = document.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await act(async () => sw.click());
    expect(fetchMock).toHaveBeenCalledWith("/api/tools/i1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: false }) }));
    expect(reload).toHaveBeenCalled();
  });

  it("«Quitar» removes it", async () => {
    await render([tool()]);
    await act(async () => byText("tools.page.remove").click());
    expect(fetchMock).toHaveBeenCalledWith("/api/tools/i1", expect.objectContaining({ method: "DELETE" }));
  });

  it("a removed one offers «Restaurar»; a release gone says so", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "release_gone" }), { status: 409 }));
    await render([tool({ status: "removed", frameUrl: null })]);
    await act(async () => byText("tools.page.restore").click());
    expect(fetchMock).toHaveBeenCalledWith("/api/tools/i1/restore", expect.objectContaining({ method: "POST" }));
    expect(document.body.textContent).toContain("tools.page.releaseGone");
  });

  it("«Abrir proyecto» goes to the tool's project", async () => {
    await render([tool()]);
    await act(async () => byText("tools.page.openProject").click());
    expect(nav.push).toHaveBeenCalledWith("/new?project=p1");
  });

  it("«Pedir a Len una herramienta» opens a blank project born as a tool, sending nothing", async () => {
    await render([]);
    await act(async () => byText("tools.page.ask").click());
    expect(nav.push).toHaveBeenCalledWith("/new?kind=tool");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("on Free, asking is closed and each tool says why", async () => {
    await render([tool({ status: "plan_required", frameUrl: null })], false);
    expect(byText("tools.page.ask").disabled).toBe(true);
    expect(document.body.textContent).toContain("tools.planRequired");
  });
});
