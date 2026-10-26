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

function Compositor(p: { files: readonly typeof MENU[]; onAttachPdf: () => void; onRemoveFile: (url: string) => void }) {
  const ta = useRef<HTMLTextAreaElement | null>(null);
  return (
    <ChatComposer
      value=""
      onChange={() => {}}
      onSubmit={() => {}}
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
    pulsar([...host.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.includes("composer.attachPdf")));
    expect(onAttachPdf).toHaveBeenCalledTimes(1);
  });

  it("🔴 each PDF is a chip with its name, and its ✕ takes it off", () => {
    const onRemoveFile = vi.fn();
    const host = montar({ files: [MENU], onAttachPdf: () => {}, onRemoveFile });
    expect(host.textContent).toContain("menu del día.pdf");
    pulsar(host.querySelector('[aria-label="composer.removeFile"]'));
    expect(onRemoveFile).toHaveBeenCalledWith(MENU.url);
  });
});
