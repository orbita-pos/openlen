// A PDF from the start screen (26/10): «Attach a PDF» in the «+» picks one,
// it waits as a chip with its name (its ✕ takes it off), and the page uploads
// it with the first message — like the photos. Same harness as
// start-landing.url.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { BriefFormState } from "@/components/workspace/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "es",
}));
vi.mock("@/lib/uso/cliente", () => ({ registrarUso: () => {} }));

import { HeroComposer } from "./start-landing";

const roots: Root[] = [];
let pdfsNow: readonly File[] = [];
function Harness() {
  const [pdfs, setPdfs] = useState<readonly File[]>([]);
  pdfsNow = pdfs;
  const state: BriefFormState = { prompt: "mi menú", setPrompt: () => {}, fotos: [], setFotos: () => {}, pdfs, setPdfs };
  return <HeroComposer state={state} onGenerate={() => {}} generating={false} effort="low" onEffortChange={() => {}} />;
}
function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    const root = createRoot(container);
    root.render(<Harness />);
    roots.push(root);
  });
  return container;
}
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
  pdfsNow = [];
});

describe("a PDF from the start screen", () => {
  it("🔴 the + offers it; a picked PDF waits as a chip; its ✕ takes it off", async () => {
    const c = render();
    act(() => c.querySelector<HTMLButtonElement>('[aria-label="newChat.composer.plus"]')!.click());
    const option = [...c.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.includes("composer.attachPdf"));
    expect(option).toBeDefined();
    const input = c.querySelector<HTMLInputElement>('input[type="file"][accept*="pdf"]')!;
    const pdf = new File(["%PDF-1.7"], "menu.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [pdf], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(pdfsNow).toEqual([pdf]);
    expect(c.textContent).toContain("menu.pdf");
    act(() => c.querySelector<HTMLButtonElement>('[aria-label="composer.removeFile"]')!.click());
    expect(pdfsNow).toEqual([]);
  });
});
