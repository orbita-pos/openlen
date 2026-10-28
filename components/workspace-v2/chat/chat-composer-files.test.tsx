// A PDF in the chat composer (26/10): «Attach a PDF» in the «+» asks for one,
// each attached PDF is a chip with its name, and its ✕ takes it off. Same
// harness as chat-composer.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (clave: string) => clave }));

import { ChatComposer } from "./chat-composer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

const MENU = { url: "/uploads/uploads/p1/abc123.pdf", name: "menu del día.pdf", size: 2048 };

function Compositor(
  p: { files: readonly typeof MENU[]; onAttachPdf: () => void; onRemoveFile: (url: string) => void } & Partial<
    Pick<Parameters<typeof ChatComposer>[0], "attachedImages" | "onRemoveImage" | "pendingUploads" | "onCancelUpload" | "onPasteFiles" | "onSubmit" | "value">
  >,
) {
  const ta = useRef<HTMLTextAreaElement | null>(null);
  return (
    <ChatComposer
      value={p.value ?? ""}
      onChange={() => {}}
      onSubmit={p.onSubmit ?? (() => {})}
      onStop={() => {}}
      busy={false}
      textareaRef={ta}
      comments={[]}
      onRemoveComment={() => {}}
      scopedSelection={null}
      sectionSelectMode={false}
      attachedImage={null}
      onAttachImage={() => {}}
      onClearAttachedImage={() => {}}
      attachedFiles={p.files}
      onAttachPdf={p.onAttachPdf}
      onRemoveFile={p.onRemoveFile}
      effort="auto"
      effortLevels={["low", "medium", "high"]}
      effortResolvesTo="medium"
      onEffortChange={() => {}}
      mode="len"
      {...(p.attachedImages ? { attachedImages: p.attachedImages } : {})}
      {...(p.onRemoveImage ? { onRemoveImage: p.onRemoveImage } : {})}
      {...(p.pendingUploads ? { pendingUploads: p.pendingUploads } : {})}
      {...(p.onCancelUpload ? { onCancelUpload: p.onCancelUpload } : {})}
      {...(p.onPasteFiles ? { onPasteFiles: p.onPasteFiles } : {})}
    />
  );
}

function montar(p: Parameters<typeof Compositor>[0]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<Compositor {...p} />));
  return host;
}
const pulsar = (el: Element | null | undefined) => {
  if (!el) throw new Error("no está");
  act(() => (el as HTMLElement).click());
};

describe("a PDF in the chat composer", () => {
  it("🔴 «Attach a PDF» in the + asks for one", () => {
    const onAttachPdf = vi.fn();
    const host = montar({ files: [], onAttachPdf, onRemoveFile: () => {} });
    pulsar(host.querySelector('[aria-label="newChat.composer.plus"]'));
    pulsar([...host.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.includes("composer.attachFile")));
    expect(onAttachPdf).toHaveBeenCalledTimes(1);
  });

  it("🔴 each PDF is a chip with its name, and its ✕ takes it off", () => {
    const onRemoveFile = vi.fn();
    const host = montar({ files: [MENU], onAttachPdf: () => {}, onRemoveFile });
    expect(host.textContent).toContain("menu del día.pdf");
    pulsar(host.querySelector('[aria-label="composer.removeFile"]'));
    expect(onRemoveFile).toHaveBeenCalledWith(MENU.url);
  });

  // Office files and CSV (spec local 2026-10-26-len-skills, §4.8).
  it("the composer chip shows the file's type", () => {
    const host = montar({ files: [{ url: "/uploads/uploads/p1/def456.xlsx", name: "ventas.xlsx", size: 4096, kind: "xlsx" } as typeof MENU, MENU], onAttachPdf: () => {}, onRemoveFile: () => {} });
    const chips = [...host.querySelectorAll("b")].map((b) => b.textContent);
    expect(chips).toContain("XLSX");
    expect(chips).toContain("PDF");
  });
});

// Drop and paste (spec local 2026-10-27-chat-drop-and-images, Part A).
describe("photos, uploads and paste in the chat composer", () => {
  const nada = { files: [] as (typeof MENU)[], onAttachPdf: () => {}, onRemoveFile: () => {} };

  it("one chip per photo, each with its ×", () => {
    const onRemoveImage = vi.fn();
    const host = montar({ ...nada, attachedImages: [{ url: "https://u/u1.jpg" }, { url: "https://u/u2.jpg" }], onRemoveImage });
    expect(host.querySelectorAll('img[src^="https://u/"]').length).toBe(2);
    const quitar = host.querySelectorAll('[aria-label="composer.removeImage"]');
    expect(quitar.length).toBe(2);
    pulsar(quitar[1]);
    expect(onRemoveImage).toHaveBeenCalledWith("https://u/u2.jpg");
  });

  it("a pending upload shows a spinner chip and blocks sending", () => {
    const onSubmit = vi.fn();
    const onCancelUpload = vi.fn();
    const host = montar({ ...nada, value: "hola", onSubmit, pendingUploads: [{ id: "up1", name: "vacaciones.mp4", kind: "file" }], onCancelUpload });
    const chip = host.querySelector('[role="status"]');
    expect(chip?.textContent).toContain("vacaciones.mp4");
    const ta = host.querySelector("textarea")!;
    act(() => void ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSubmit).not.toHaveBeenCalled();
    pulsar(host.querySelector('[aria-label="composer.cancelUpload"]'));
    expect(onCancelUpload).toHaveBeenCalledWith("up1");
  });

  const pegar = (ta: HTMLTextAreaElement, files: File[], text: string) => {
    const e = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    e.clipboardData = { files, getData: (t: string) => (t === "text/plain" ? text : "") };
    act(() => void ta.dispatchEvent(e));
    return e;
  };

  it("pasting files hands them over; a text-only paste is untouched", () => {
    const onPasteFiles = vi.fn();
    const host = montar({ ...nada, onPasteFiles });
    const ta = host.querySelector("textarea")!;
    const png = new File([new Uint8Array(1)], "captura.png", { type: "image/png" });
    const conFoto = pegar(ta, [png], "");
    expect(onPasteFiles).toHaveBeenCalledWith([png]);
    expect(conFoto.defaultPrevented).toBe(true);
    onPasteFiles.mockClear();
    const soloTexto = pegar(ta, [], "hola");
    expect(onPasteFiles).not.toHaveBeenCalled();
    expect(soloTexto.defaultPrevented).toBe(false);
  });
});
