// The phone's «Herramientas» (spec local 2026-11-04-herramientas-hechas-por-len, §4.14): the person's rail tools that
// can open, read again every time the tab opens; the Free plan's notice; a tap opens one.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("use-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("../api/herramientas", async (original) => ({ ...(await original<typeof import("../api/herramientas")>()), listarHerramientas: vi.fn(), iconoDeHerramienta: vi.fn(async () => null) }));
vi.mock("../atras", () => ({ useAtras: () => {} }));

import { listarHerramientas } from "../api/herramientas";
import { ToolsTab } from "./tools-tab";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const tool = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  projectId: `t-${id}`,
  title: `Tool ${id}`,
  description: `About ${id}`,
  placement: "rail",
  iconUrl: `/api/tools/${id}/icon`,
  iconTinted: true,
  frameUrl: "https://x",
  frameOrigin: "https://x",
  releaseSha: "sha",
  enabled: true,
  installedAt: "2026-11-05T10:00:00Z",
  status: "ok",
  ...o,
});

async function paint(answer: unknown, onAbrir = vi.fn()) {
  vi.mocked(listarHerramientas).mockResolvedValue(answer as never);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ToolsTab cliente={{} as never} idioma="es" onCerrar={() => {}} onAbrir={onAbrir} />));
  return { host, onAbrir };
}

describe("ToolsTab", () => {
  it("only the rail tools that can open, with their title and description", async () => {
    const { host } = await paint({
      paid: true,
      person: { name: "Ana" },
      tools: [tool("a"), tool("b", { placement: "project" }), tool("c", { enabled: false }), tool("d", { status: "broken" }), tool("e", { status: "removed" })],
    });
    const rows = [...host.querySelectorAll("[data-tool-row]")];
    expect(rows.map((r) => r.querySelector("b")?.textContent)).toEqual(["Tool a"]);
    expect(rows[0]!.textContent).toContain("About a");
  });

  it("a tap opens that tool", async () => {
    const { host, onAbrir } = await paint({ paid: true, person: { name: "Ana" }, tools: [tool("a")] });
    await act(async () => host.querySelector<HTMLButtonElement>("[data-tool-row]")!.click());
    expect(onAbrir).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("the Free plan: the paid plan's notice, no list", async () => {
    const { host } = await paint({ paid: false, person: { name: "Ana" }, tools: [tool("a", { status: "plan_required" })] });
    expect(host.textContent).toContain("tools.planRequired");
    expect(host.querySelector("[data-tool-row]")).toBeNull();
  });

  it("none yet: where they come from", async () => {
    const { host } = await paint({ paid: true, person: { name: "Ana" }, tools: [] });
    expect(host.textContent).toContain("vacio");
  });

  it("a failure offers «Reintentar», which asks again", async () => {
    vi.mocked(listarHerramientas).mockRejectedValueOnce(new Error("500"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    vi.mocked(listarHerramientas).mockResolvedValue({ paid: true, person: { name: "Ana" }, tools: [tool("a")] } as never);
    await act(async () => root.render(<ToolsTab cliente={{} as never} idioma="es" onCerrar={() => {}} onAbrir={() => {}} />));
    expect(host.textContent).toContain("reintentar");
    await act(async () => host.querySelector<HTMLButtonElement>(".gestion-error button")!.click());
    expect(host.querySelectorAll("[data-tool-row]")).toHaveLength(1);
  });

  it("the list is read again every time the tab opens: a tool removed on the web is gone (Review Focus 3)", async () => {
    await paint({ paid: true, person: { name: "Ana" }, tools: [tool("a")] });
    const { host } = await paint({ paid: true, person: { name: "Ana" }, tools: [] });
    expect(listarHerramientas).toHaveBeenCalledTimes(2);
    expect(host.querySelector("[data-tool-row]")).toBeNull();
  });
});
