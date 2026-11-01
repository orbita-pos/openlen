// What Len delivered, as cards in the phone's chat (spec local 2026-10-31-len-movil, §5.1): tapping one
// opens the viewer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("use-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("../viewer/phone-viewer", () => ({ PhoneViewer: ({ file }: { file: { name: string } }) => <div role="dialog" aria-label={file.name} /> }));

import { DeliveredCards } from "./delivered-cards";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

describe("DeliveredCards", () => {
  it("one card per file, and tapping it opens the viewer", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    const files = [
      { name: "deck.pptx", url: "/api/projects/p1/deliveries/t1/ab12cd34-deck.pptx", size: 2048, description: "Ventas" },
      { name: "a.pdf", url: "/api/projects/p1/deliveries/t1/ab12cd34-a.pdf", size: 10 },
    ];
    act(() => root.render(<DeliveredCards cliente={{} as never} archivos={files} />));
    const cards = host.querySelectorAll("[data-delivered-card]");
    expect(cards).toHaveLength(2);
    expect(host.textContent).toContain("Ventas");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    act(() => (cards[0] as HTMLButtonElement).click());
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("deck.pptx");
  });
});
