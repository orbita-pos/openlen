// A SCHEDULED TASK'S TURN, IN THE CHAT (spec local 2026-10-29-tareas-programadas, §7.5): the task's
// prompt shows as the person's message with a «⏰ Tarea programada · <when>» label. The model's
// framing (`[SCHEDULE REMINDER]`) is never shown.
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

describe("a scheduled task's turn in the chat", () => {
  it("shows the prompt with the scheduled label, not the thread's button", () => {
    const turn = restoreTurn({
      id: "run-1",
      userText: "Hazme el PDF de resultados de la semana pasada",
      assistantReasoning: "",
      status: "applied",
      appliedAt: 0,
      origen: { kind: "scheduled", taskId: "schedule-1", title: "PDF de resultados", occurrenceAt: "2026-11-02T15:03:00.000Z" },
    });
    const host = paint(turn);
    expect(host.textContent).toContain("Hazme el PDF de resultados de la semana pasada");
    const label = host.querySelector<HTMLElement>("[data-scheduled-turn]")!;
    expect(label).not.toBeNull();
    expect(label.textContent).toContain("turn.scheduled");
    expect(label.textContent).toContain('"title":"PDF de resultados"');
    expect(host.querySelector("[data-origen-del-turno]")).toBeNull();
    expect(host.textContent).not.toContain("SCHEDULE REMINDER");
  });

  it("a thread's turn keeps its button", () => {
    const turn = restoreTurn({ id: "f1", userText: "@Len x", assistantReasoning: "", status: "applied", appliedAt: 0, origen: { hiloId: "h1", ruta: "/a.js", linea: 1 } });
    const host = paint(turn);
    expect(host.querySelector("[data-origen-del-turno]")).not.toBeNull();
    expect(host.querySelector("[data-scheduled-turn]")).toBeNull();
  });
});
