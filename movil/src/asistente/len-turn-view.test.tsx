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

  it("rereads while Len works and stops when he's done", async () => {
    m.leer.mockResolvedValueOnce({ turno: turn({ enCurso: true }), turnoId: "t1" }).mockResolvedValueOnce({ turno: turn() });
    await paint();
    await act(async () => vi.advanceTimersByTime(4000));
    await act(async () => vi.advanceTimersByTime(12000));
    expect(m.leer).toHaveBeenCalledTimes(2);
  });

  it("a row that isn't there says so", async () => {
    m.leer.mockRejectedValue(new Error("OpenLen respondió 404"));
    await paint();
    expect(host.textContent).toContain("turnoNoEsta");
  });
});
