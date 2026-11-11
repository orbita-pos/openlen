// «LUCÍA, DILE A LEN…» IN LEN'S CHAT (spec local 2026-11-06-asistente-propio, §4.2): the owner's request, passed on by
// their own assistant with `ask_len`, shows as the owner's message with a «De Lucía» label. The model's framing never shows.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => (v ? `${clave} ${JSON.stringify(v)}` : clave),
  useLocale: () => "es",
}));

import { UserMessage } from "./chat-turn";
import { restoreTurn } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function paint(turn: ReturnType<typeof restoreTurn>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<UserMessage turn={turn} initial="A" onAbrirOrigen={() => {}} />));
  return host;
}

describe("a request from the person's own assistant, in Len's chat", () => {
  it("shows the owner's words with a «from» label naming the assistant, not the thread's button", () => {
    const turn = restoreTurn({
      id: "req-1",
      userText: "que el botón de pedir se vea más grande",
      assistantReasoning: "",
      status: "applied",
      appliedAt: 0,
      origen: { kind: "assistant", assistantId: "a1", assistantName: "Lucía" },
    });
    const host = paint(turn);
    expect(host.textContent).toContain("que el botón de pedir se vea más grande");
    const label = host.querySelector<HTMLElement>("[data-assistant-request-turn]")!;
    expect(label).not.toBeNull();
    expect(label.textContent).toContain("turn.fromAssistant");
    expect(label.textContent).toContain('"name":"Lucía"');
    expect(host.querySelector("[data-origen-del-turno]")).toBeNull();
  });
});
