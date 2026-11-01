// The phone's viewer of what Len delivered (spec local 2026-10-31-len-movil, §5.1): the shared viewer,
// fetching with the phone's key (an <img src> can't carry it), with Share and Open with.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("use-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@/components/viewer/pdf-pages", () => ({ PdfPages: () => <div data-pdf-pages="" /> }));
vi.mock("./file-actions", () => ({ shareFile: vi.fn(async () => undefined), openWith: vi.fn(async () => undefined) }));
vi.mock("../sesion/plataforma", () => ({ plataforma: { soloDePie: vi.fn(), girarLibre: vi.fn() } }));

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { plataforma } from "../sesion/plataforma";
import { openWith, shareFile } from "./file-actions";
import { PhoneViewer } from "./phone-viewer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:x/1");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function client(): ClienteDeOpenLen & { pedir: ReturnType<typeof vi.fn> } {
  return {
    pedir: vi.fn(async (ruta: string) => (ruta.endsWith("/view") ? Response.json({ url: "http://lz.localhost/?__lienzo=d" }) : new Response(new Blob(["%PDF-"])))),
    avisarAlCerrar: vi.fn(),
  } as never;
}

async function paint(file: { name: string; url: string; size: number; preview?: string }, onClose: () => void = () => undefined) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const c = client();
  await act(async () => root.render(<PhoneViewer cliente={c} file={file} onClose={onClose} />));
  return { host, c };
}

const back = () =>
  act(async () => {
    history.back();
    await new Promise((r) => setTimeout(r, 20));
  });

describe("PhoneViewer", () => {
  it("an Office file is fetched from its preview, with the phone's client", async () => {
    const { host, c } = await paint({ name: "deck.pptx", url: "/api/projects/p1/deliveries/t1/ab12cd34-deck.pptx", size: 9, preview: "/api/projects/p1/deliveries/t1/ef56ab78-deck.pptx.preview.pdf" });
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(c.pedir).toHaveBeenCalledWith("/api/projects/p1/deliveries/t1/ef56ab78-deck.pptx.preview.pdf");
    expect(c.pedir).not.toHaveBeenCalledWith("/api/projects/p1/deliveries/t1/ab12cd34-deck.pptx");
  });

  it("an HTML asks the view route with a POST", async () => {
    const { host, c } = await paint({ name: "panel.html", url: "/api/projects/p1/deliveries/t1/ab12cd34-panel.html", size: 9 });
    expect(c.pedir).toHaveBeenCalledWith("/api/projects/p1/deliveries/t1/ab12cd34-panel.html/view", { method: "POST" });
    expect(host.querySelector("iframe")?.getAttribute("src")).toBe("http://lz.localhost/?__lienzo=d");
  });

  it("Share and Open with take the original file", async () => {
    const file = { name: "deck.pptx", url: "/api/projects/p1/deliveries/t1/ab12cd34-deck.pptx", size: 9 };
    const { host, c } = await paint(file);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-share]")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>("[data-open-with]")!.click());
    expect(c.pedir).toHaveBeenCalledWith(file.url);
    expect(shareFile).toHaveBeenCalledWith(file, expect.any(Blob));
    expect(openWith).toHaveBeenCalledWith(file, expect.any(Blob));
  });

  it("from «Entregado» it offers going to the turn's chat", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    const onGoToChat = vi.fn();
    await act(async () => root.render(<PhoneViewer cliente={client()} file={{ name: "a.pdf", url: "/x/a.pdf", size: 9 }} onClose={() => undefined} onGoToChat={onGoToChat} />));
    act(() => host.querySelector<HTMLButtonElement>("[data-go-to-chat]")!.click());
    expect(onGoToChat).toHaveBeenCalledTimes(1);
  });

  it("without where to go, no chat button", async () => {
    const { host } = await paint({ name: "a.pdf", url: "/x/a.pdf", size: 9 });
    expect(host.querySelector("[data-go-to-chat]")).toBeNull();
  });

  it("the app stays upright; only the viewer turns, and closing it stands the phone up again", async () => {
    const { host } = await paint({ name: "a.pdf", url: "/x/a.pdf", size: 9 });
    expect(plataforma.girarLibre).toHaveBeenCalledTimes(1);
    expect(plataforma.soloDePie).not.toHaveBeenCalled();
    act(() => roots.pop()!.unmount());
    expect(plataforma.soloDePie).toHaveBeenCalledTimes(1);
    expect(host.childElementCount).toBe(0);
  });

  it("Android's back closes the viewer", async () => {
    const onClose = vi.fn();
    await paint({ name: "a.pdf", url: "/api/projects/p1/deliveries/t1/ab12cd34-a.pdf", size: 9 }, onClose);
    await back();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
