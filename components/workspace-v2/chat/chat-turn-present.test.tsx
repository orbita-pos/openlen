// The files Len delivers with `present` (spec local 2026-10-26-len-skills, §4.9): one download card
// per file in his turn, opening in a new tab without the opener.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (clave: string) => clave }));
vi.mock("@/components/viewer/pdf-pages", () => ({ PdfPages: () => <div data-pdf-pages="" /> }));

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
      { tool: "present", status: "done", summary: "", delivered: [{ name: "inventario.xlsx", url: "/api/projects/p1/deliveries/t1/ab12cd34-inventario.xlsx", size: 5120, description: "Inventory" }] },
      { tool: "present", status: "done", summary: "", delivered: [{ name: "carta.docx", url: "/api/projects/p1/deliveries/t2/ab12cd34-carta.docx", size: 900 }] },
      { tool: "Read", status: "done", summary: "x" },
    ]);
    const links = [...host.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/api/projects/p1/deliveries/t1/ab12cd34-inventario.xlsx", "/api/projects/p1/deliveries/t2/ab12cd34-carta.docx"]);
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

  // Seen without downloading (spec local 2026-10-31-len-movil, §5.1): the card opens the shared viewer.
  it("tapping a card opens the viewer, with a download link to the file", async () => {
    globalThis.fetch = vi.fn(async () => new Response(new Blob(["%PDF-"]))) as typeof fetch;
    URL.createObjectURL = vi.fn(() => "blob:http://x/1");
    URL.revokeObjectURL = vi.fn();
    const url = "/api/projects/p1/deliveries/t1/ab12cd34-deck.pptx";
    const host = mount([{ tool: "present", status: "done", summary: "", delivered: [{ name: "deck.pptx", url, size: 900, preview: "/api/projects/p1/deliveries/t1/ef56ab78-deck.pptx.preview.pdf" }] }]);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-delivered-open]")!.click());
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-label")).toBe("deck.pptx");
    expect(dialog?.querySelector(`a[href="${url}"][download]`)).not.toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/projects/p1/deliveries/t1/ef56ab78-deck.pptx.preview.pdf");
  });

  it("a card from before previews existed still opens", async () => {
    const host = mount([{ tool: "present", status: "done", summary: "", delivered: [{ name: "old.docx", url: "/api/projects/p1/deliveries/t1/ab12cd34-old.docx", size: 900 }] }]);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-delivered-open]")!.click());
    expect(document.body.textContent).toContain("viewer.noPreview");
  });
});
