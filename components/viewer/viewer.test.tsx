// The shared viewer of what Len delivers (spec local 2026-10-31-len-movil, §5.1), as the web and the
// phone mount it: every string and every way to fetch comes from the host.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("./pdf-pages", () => ({ PdfPages: ({ blob }: { blob: Blob }) => <div data-pdf-pages="" data-size={blob.size} /> }));

import { Viewer, type ViewerFile, type ViewerLabels } from "./viewer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LABELS: ViewerLabels = {
  close: "Cerrar",
  download: "Descargar",
  noPreview: "Vista previa no disponible",
  loading: "Cargando…",
  failed: "No se pudo abrir",
  page: (n, total) => `${n} / ${total}`,
};

const roots: Root[] = [];
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:http://x/1");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

async function paint(file: ViewerFile, o: { loadBytes?: (url: string) => Promise<Blob>; openHtml?: (url: string) => Promise<string>; onClose?: () => void } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const loadBytes = o.loadBytes ?? vi.fn(async () => new Blob(["abc"]));
  const openHtml = o.openHtml ?? vi.fn(async () => "http://lz-x.localhost:3000/?__lienzo=d1");
  const onClose = o.onClose ?? vi.fn();
  await act(async () => {
    root.render(<Viewer file={file} loadBytes={loadBytes} openHtml={openHtml} labels={LABELS} onClose={onClose} actions={<a data-download="" href={file.url}>{LABELS.download}</a>} />);
  });
  return { host, loadBytes, openHtml, onClose };
}

const file = (name: string, over: Partial<ViewerFile> = {}): ViewerFile => ({ name, url: `/api/projects/p1/deliveries/t1/ab12cd34-${name}`, size: 3, ...over });

describe("Viewer", () => {
  it("is a dialog named after the file", async () => {
    const { host } = await paint(file("a.png"));
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-label")).toBe("a.png");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
  });

  it("an image is fetched by the host and shown from a blob", async () => {
    const { host, loadBytes } = await paint(file("a.png"));
    expect(loadBytes).toHaveBeenCalledWith("/api/projects/p1/deliveries/t1/ab12cd34-a.png");
    expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:http://x/1");
  });

  it("an Office file shows its PDF preview, fetched from `preview`", async () => {
    const preview = "/api/projects/p1/deliveries/t1/ef56ab78-deck.pptx.preview.pdf";
    const { host, loadBytes } = await paint(file("deck.pptx", { preview }));
    expect(loadBytes).toHaveBeenCalledWith(preview);
    expect(host.querySelector("[data-pdf-pages]")).not.toBeNull();
  });

  it("an Office file without a preview says so and offers the actions", async () => {
    const { host, loadBytes } = await paint(file("old.docx"));
    expect(loadBytes).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Vista previa no disponible");
    expect(host.querySelector("[data-download]")).not.toBeNull();
  });

  it("an HTML opens in a frame at the URL the host answers", async () => {
    const { host, openHtml, loadBytes } = await paint(file("panel.html"));
    expect(openHtml).toHaveBeenCalledWith("/api/projects/p1/deliveries/t1/ab12cd34-panel.html");
    expect(loadBytes).not.toHaveBeenCalled();
    expect(host.querySelector("iframe")?.getAttribute("src")).toBe("http://lz-x.localhost:3000/?__lienzo=d1");
  });

  it("a PDF is drawn page by page", async () => {
    const { host } = await paint(file("a.pdf"));
    expect(host.querySelector("[data-pdf-pages]")).not.toBeNull();
  });

  it("a text file is shown as text", async () => {
    const { host } = await paint(file("notes.md"), { loadBytes: async () => new Blob(["# Hola"]) });
    // FileReader answers on a later task than the microtasks `act` flushes.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(host.querySelector("pre")?.textContent).toBe("# Hola");
  });

  it("a file it can't show offers the actions", async () => {
    const { host } = await paint(file("x.zip"));
    expect(host.querySelector("[data-download]")).not.toBeNull();
  });

  it("a fetch that fails says so", async () => {
    const { host } = await paint(file("a.png"), { loadBytes: async () => Promise.reject(new Error("401")) });
    expect(host.textContent).toContain("No se pudo abrir");
  });

  it("Escape and the close button close it", async () => {
    const onClose = vi.fn();
    const { host } = await paint(file("a.png"), { onClose });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    act(() => host.querySelector<HTMLButtonElement>("[data-viewer-close]")!.click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("gives the blob URL back when it closes", async () => {
    await paint(file("a.png"));
    for (const r of roots.splice(0)) act(() => r.unmount());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://x/1");
  });
});
