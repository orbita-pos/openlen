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

  // An agent's MESSAGE to Len (spec local 2026-11-21-len-y-el-agente-conversan): its turn in Len's chat carries the same
  // `assistant` origin plus `message: true`, and its row says «De <agent>» exactly as a request does.
  it("an agent's message to Len shows «De <agent>» as a request does", () => {
    const turn = restoreTurn({
      id: "msg-1",
      userText: "¿Cuál es el tope de gasto de la página?",
      assistantReasoning: "",
      status: "applied",
      appliedAt: 0,
      origen: { kind: "assistant", assistantId: "a1", assistantName: "Finanzas", message: true },
    });
    const host = paint(turn);
    expect(host.textContent).toContain("¿Cuál es el tope de gasto de la página?");
    const label = host.querySelector<HTMLElement>("[data-assistant-request-turn]")!;
    expect(label).not.toBeNull();
    expect(label.textContent).toContain("turn.fromAssistant");
    expect(label.textContent).toContain('"name":"Finanzas"');
    expect(host.querySelector("[data-len-message-turn]")).toBeNull();
    expect(host.querySelector("[data-origen-del-turno]")).toBeNull();
  });
});

describe("a message from Len, in the agent's own chat", () => {
  it("shows the message with a «from Len» label naming the project, not the thread's button", () => {
    const turn = restoreTurn({
      id: "msg-2",
      userText: "¿Puedes revisar el presupuesto de la página?",
      assistantReasoning: "",
      status: "applied",
      appliedAt: 0,
      origen: { kind: "len-message", projectId: "p1", projectTitle: "Presupuesto" },
    });
    const host = paint(turn);
    expect(host.textContent).toContain("¿Puedes revisar el presupuesto de la página?");
    const label = host.querySelector<HTMLElement>("[data-len-message-turn]")!;
    expect(label).not.toBeNull();
    expect(label.textContent).toContain("turn.fromLen");
    expect(label.textContent).toContain('"project":"Presupuesto"');
    // It is not a thread's origin (that one has a file and opens it), and not an agent's request either.
    expect(host.querySelector("[data-origen-del-turno]")).toBeNull();
    expect(host.querySelector("[data-assistant-request-turn]")).toBeNull();
  });

  it("a thread's origin still opens its file", () => {
    const turn = restoreTurn({
      id: "msg-3",
      userText: "@Len esto",
      assistantReasoning: "",
      status: "applied",
      appliedAt: 0,
      origen: { hiloId: "h1", ruta: "/index.html", linea: 7 },
    });
    const host = paint(turn);
    expect(host.querySelector("[data-origen-del-turno]")?.textContent).toContain("turn.desdeElHilo");
    expect(host.querySelector("[data-len-message-turn]")).toBeNull();
  });

  // Deferred minor of Task 7: an unrecognized origin object without `ruta` must not throw on `.ruta.replace(...)`,
  // and the real panelsChat.json copy says «De Len · {project}» / «From Len · {project}».
  it("🔴 an unrecognized origin object renders the message without crashing, and panelsChat carries the copy", async () => {
    const turn = restoreTurn({
      id: "msg-4",
      userText: "Hola",
      assistantReasoning: "",
      status: "applied",
      appliedAt: 0,
      origen: { kind: "future-origin" } as unknown as NonNullable<Parameters<typeof restoreTurn>[0]["origen"]>,
    });
    const host = paint(turn);
    expect(host.textContent).toContain("Hola");
    expect(host.querySelector("[data-origen-del-turno]")).toBeNull();
    const es = (await import("@/messages/es/panelsChat.json")).default;
    const en = (await import("@/messages/en/panelsChat.json")).default;
    expect(es.turn.fromLen).toBe("De Len · {project}");
    expect(en.turn.fromLen).toBe("From Len · {project}");
    expect(es.turn.fromAssistant).toBe("De {name}");
    expect(en.turn.fromAssistant).toBe("From {name}");
  });
});
