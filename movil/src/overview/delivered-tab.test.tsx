// The phone's «Entregado» (spec local 2026-10-31-len-movil, §5.3): what Len delivered across projects,
// newest first; tapping one opens the viewer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("use-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("../api/overview", () => ({ fetchDelivered: vi.fn() }));
vi.mock("../viewer/phone-viewer", () => ({ PhoneViewer: ({ file }: { file: { name: string; preview?: string } }) => <div role="dialog" aria-label={file.name} data-preview={file.preview ?? ""} /> }));

import { fetchDelivered } from "../api/overview";
import { DeliveredTab } from "./delivered-tab";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

const item = (name: string, createdAt: string, o: Record<string, unknown> = {}) => ({ id: name, projectId: "p1", turnId: "t1", name, url: `/api/projects/p1/deliveries/t1/ab12cd34-${name}`, previewUrl: null, size: 10, contentType: "application/pdf", description: null, createdAt, projectTitle: "Mi tienda", ...o });

async function paint(items: unknown[]) {
  vi.mocked(fetchDelivered).mockResolvedValue(items as never);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<DeliveredTab cliente={{} as never} onCerrar={() => undefined} />));
  return host;
}

describe("DeliveredTab", () => {
  it("lists them in the order the server gives, newest first, with the project", async () => {
    const host = await paint([item("new.pdf", "2026-11-10T18:00:00Z"), item("old.pdf", "2026-11-01T18:00:00Z")]);
    const rows = [...host.querySelectorAll("[data-delivered-item]")];
    expect(rows.map((r) => r.querySelector("b")?.textContent)).toEqual(["new.pdf", "old.pdf"]);
    expect(rows[0]!.textContent).toContain("Mi tienda");
  });

  it("tapping one opens the viewer with its preview", async () => {
    const host = await paint([item("deck.pptx", "2026-11-10T18:00:00Z", { previewUrl: "/api/projects/p1/deliveries/t1/ef56ab78-deck.pptx.preview.pdf" })]);
    act(() => host.querySelector<HTMLButtonElement>("[data-delivered-item]")!.click());
    const dialog = document.body.querySelector('[role="dialog"][aria-label]');
    expect(dialog?.getAttribute("aria-label")).toBe("deck.pptx");
    expect(dialog?.getAttribute("data-preview")).toBe("/api/projects/p1/deliveries/t1/ef56ab78-deck.pptx.preview.pdf");
  });

  it("with nothing delivered it says so", async () => {
    expect((await paint([])).textContent).toContain("vacioEntregado");
  });
});
