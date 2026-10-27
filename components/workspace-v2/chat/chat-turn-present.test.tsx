// The files Len delivers with `present` (spec local 2026-10-26-len-skills, §4.9): one download card
// per file in his turn, opening in a new tab without the opener.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (clave: string) => clave }));

import { DeliveredFiles } from "./delivered-files";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function mount(actions: Parameters<typeof DeliveredFiles>[0]["actions"]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<DeliveredFiles actions={actions} />));
  return host;
}

describe("DeliveredFiles", () => {
  it("the turn shows a download card per presented file", () => {
    const host = mount([
      { tool: "present", status: "done", summary: "", delivered: [{ name: "inventario.xlsx", url: "https://cdn.example/d/inventario.xlsx", size: 5120, description: "Inventory" }] },
      { tool: "present", status: "done", summary: "", delivered: [{ name: "carta.docx", url: "https://cdn.example/d/carta.docx", size: 900 }] },
      { tool: "Read", status: "done", summary: "x" },
    ]);
    const links = [...host.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://cdn.example/d/inventario.xlsx", "https://cdn.example/d/carta.docx"]);
    for (const a of links) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.hasAttribute("download")).toBe(true);
    }
    expect(host.textContent).toContain("inventario.xlsx");
    expect(host.textContent).toContain("Inventory");
    expect(host.textContent).toContain("turn.deliveredFiles");
  });

  it("no present, nothing", () => {
    expect(mount([{ tool: "Read", status: "done", summary: "x" }]).innerHTML).toBe("");
  });
});
