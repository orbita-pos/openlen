import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredChatTurn } from "@/lib/projects/types";

import { LenTurnView } from "./len-turn-view";

const m = vi.hoisted(() => ({ leer: vi.fn() }));
vi.mock("../api/proyectos", () => ({ leerTurno: m.leer }));
vi.mock("use-intl", () => ({ useTranslations: () => (k: string, v?: Record<string, string>) => (v ? `${k}:${Object.values(v).join(",")}` : k) }));
vi.mock("../entrega/entrega", () => ({ Progreso: () => <div data-progreso="" /> }));
vi.mock("../atras", () => ({ useAtras: () => {} }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cliente = { pedir: vi.fn(), avisarAlCerrar: vi.fn() };
const turn = (o: Partial<StoredChatTurn> = {}): StoredChatTurn => ({ id: "f1", userText: "pon el botón verde", assistantReasoning: "Cambié el botón.\n\nListo: ahora es verde.", status: "applied", ...o });
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  m.leer.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const paint = async () => act(async () => root.render(<LenTurnView cliente={cliente} fila="f1" projectTitle="Pan" onClose={vi.fn()} />));

describe("what Len did, to read (spec local 2026-11-16-movil-es-tu-asistente, §5.4.9)", () => {
  it("🔴 shows what Len did and has nowhere to type", async () => {
    m.leer.mockResolvedValue({ turno: turn({ origen: { kind: "assistant", assistantId: "a1", assistantName: "Lucía" } as StoredChatTurn["origen"] }) });
    await paint();
    expect(m.leer).toHaveBeenCalledWith(cliente, "f1");
    const text = host.textContent ?? "";
    expect(text).toContain("pon el botón verde");
    expect(text).toContain("Cambié el botón.");
    expect(text).toContain("Listo: ahora es verde.");
    expect(text).toContain("deElla:Lucía");
    expect(text).toContain("Pan");
    expect(host.querySelector("textarea, input")).toBeNull();
  });

  // An agent's MESSAGE to Len (spec local 2026-11-21-len-y-el-agente-conversan) is read like a request: «De <agent>».
  it("🔴 the turn an agent's message woke says who it is from", async () => {
    m.leer.mockResolvedValue({ turno: turn({ userText: "¿Cuál es el tope?", origen: { kind: "assistant", assistantId: "a1", assistantName: "Finanzas", message: true } as StoredChatTurn["origen"] }) });
    await paint();
    const text = host.textContent ?? "";
    expect(text).toContain("deElla:Finanzas");
    expect(text).toContain("¿Cuál es el tope?");
  });

  it("rereads while Len works and stops when he's done", async () => {
    m.leer.mockResolvedValueOnce({ turno: turn({ enCurso: true }), turnoId: "t1" }).mockResolvedValueOnce({ turno: turn() });
    await paint();
    await act(async () => vi.advanceTimersByTime(4000));
    await act(async () => vi.advanceTimersByTime(12000));
    expect(m.leer).toHaveBeenCalledTimes(2);
  });

  // Deferred minor of the final review: a question Len ended on had no answer on the phone.
  describe("🔴 a turn that ended on Len's question", () => {
    const asked = (preguntas: unknown[]) => ({ tool: "ask_user_question", status: "done" as const, summary: "", preguntas }) as NonNullable<StoredChatTurn["actions"]>[number];
    const answer = vi.fn();
    const paintToAnswer = async () => act(async () => root.render(<LenTurnView cliente={cliente} fila="f1" projectTitle="Pan" onClose={vi.fn()} onAnswer={answer} />));
    beforeEach(() => answer.mockReset());

    it("shows it, and an option sends its label (without «(Recommended)»)", async () => {
      m.leer.mockResolvedValue({ turno: turn({ actions: [asked([{ id: "q1", question: "¿Azul o verde?", options: [{ label: "Azul (Recommended)" }, { label: "Verde" }] }])] }) });
      await paintToAnswer();
      expect(host.textContent).toContain("¿Azul o verde?");
      act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "Azul (Recommended)")!.click());
      expect(answer).toHaveBeenCalledWith("Azul");
    });

    it("an answer in your own words goes as written", async () => {
      m.leer.mockResolvedValue({ turno: turn({ actions: [asked([{ id: "q1", question: "¿Qué foto?" }])] }) });
      await paintToAnswer();
      const box = host.querySelector("textarea")!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "la del local");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
      act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "contestar")!.click());
      expect(answer).toHaveBeenCalledWith("la del local");
    });

    it("already answered, or with nowhere to answer: nothing to type", async () => {
      m.leer.mockResolvedValue({ turno: turn({ actions: [{ ...asked([{ id: "q1", question: "¿Azul?" }]), respuesta: "Azul" }] }) });
      await paintToAnswer();
      expect(host.querySelector("textarea")).toBeNull();
      m.leer.mockResolvedValue({ turno: turn({ actions: [asked([{ id: "q1", question: "¿Azul?" }])] }) });
      await paint();
      expect(host.querySelector("textarea")).toBeNull();
    });
  });

  it("a row that isn't there says so", async () => {
    m.leer.mockRejectedValue(new Error("OpenLen respondió 404"));
    await paint();
    expect(host.textContent).toContain("turnoNoEsta");
  });
});
