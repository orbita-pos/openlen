// A PDF in the user's bubble (26/10): proof it went with the message, as the
// photos are — its name, and a link that opens it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (clave: string) => clave }));

import { UserMessage } from "./chat-turn";
import type { DesignTurn } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function pintar(turn: Partial<DesignTurn>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<UserMessage turn={{ id: "t", userText: "pon mi menú", assistantReasoning: "", status: "applied", ...turn } as DesignTurn} initial="J" />));
  return host;
}

describe("a PDF in the user's bubble", () => {
  it("🔴 shows its name, linked to the file", () => {
    const host = pintar({ attachedFiles: [{ url: "/uploads/uploads/p1/abc123.pdf", name: "menu.pdf", size: 2048 }] });
    const a = host.querySelector<HTMLAnchorElement>('a[href="/uploads/uploads/p1/abc123.pdf"]');
    expect(a?.textContent).toContain("menu.pdf");
    expect(a?.target).toBe("_blank");
    expect(a?.rel).toContain("noopener");
  });

  it("a message without files has no file row", () => {
    expect(pintar({}).querySelector("a[href$='.pdf']")).toBeNull();
  });
});
