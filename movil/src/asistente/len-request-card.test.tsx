import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LenRequestView } from "@/lib/assistants/len-requests";

import { LenRequestCard } from "./len-request-card";

vi.mock("use-intl", () => ({ useTranslations: () => (k: string, v?: Record<string, string>) => (v ? `${k}:${Object.values(v).join(",")}` : k) }));
vi.mock("../entrega/entrega", () => ({ Progreso: ({ pasos }: { pasos: unknown[] }) => <div data-pasos={pasos.length} /> }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REF = { filaId: "f1", projectId: "p1" };
let root: Root;
let host: HTMLDivElement;
const on = { stop: vi.fn(), compare: vi.fn(), publish: vi.fn(), open: vi.fn() };
function paint(view: LenRequestView | undefined) {
  act(() =>
    root.render(<LenRequestCard view={view} lenRef={REF} projectTitle="Pan" name="Lucía" onStop={on.stop} onCompare={on.compare} onPublish={on.publish} onOpen={on.open} />),
  );
  return { text: host.textContent ?? "", buttons: [...host.querySelectorAll("button")].map((b) => b.textContent) };
}
beforeEach(() => {
  Object.values(on).forEach((f) => f.mockReset());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Len's card in her chat (spec local 2026-11-16-movil-es-tu-asistente, §5.4)", () => {
  it("before anything is known, and queued: Len has it in line", () => {
    expect(paint(undefined).text).toContain("lenEnCola");
    expect(paint({ filaId: "f1", status: "queued" }).text).toContain("lenEnCola");
  });

  it("running: where he works, his steps, and «Parar» with his turn", () => {
    const { text, buttons } = paint({ filaId: "f1", status: "running", turnoId: "t1", turn: { id: "f1", userText: "", assistantReasoning: "", status: "applied", enCurso: true, actions: [{ tool: "Edit", status: "running", summary: "" }] } });
    expect(text).toContain("lenTrabajandoEn:Pan");
    expect(host.querySelector("[data-pasos]")).not.toBeNull();
    expect(buttons).toContain("parar");
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "parar")!.click());
    expect(on.stop).toHaveBeenCalledWith("t1");
  });

  it("running with no live turn to stop: no «Parar»", () => {
    expect(paint({ filaId: "f1", status: "running" }).buttons).not.toContain("parar");
  });

  it("done: what Len said last, «Antes / Ahora» and «Publicar»", () => {
    const { text, buttons } = paint({ filaId: "f1", status: "done", turn: { id: "f1", userText: "", assistantReasoning: "Cambié el color.\n\nListo: el botón es verde.", status: "applied" } });
    expect(text).toContain("lenTermino");
    expect(text).toContain("Listo: el botón es verde.");
    expect(text).not.toContain("Cambié el color.");
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "antesAhora")!.click());
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "publicar")!.click());
    expect(on.compare).toHaveBeenCalled();
    expect(on.publish).toHaveBeenCalled();
    expect(buttons).toContain("verLoQueHizo");
  });

  it("failed for lack of credits says so; failed otherwise, that he couldn't", () => {
    expect(paint({ filaId: "f1", status: "failed", reason: "no_credits" }).text).toContain("sinCreditos");
    const { text } = paint({ filaId: "f1", status: "failed", reason: "boom" });
    expect(text).toContain("lenNoPudo");
    expect(text).not.toContain("sinCreditos");
  });

  it("lost: ask her again", () => {
    expect(paint({ filaId: "f1", status: "lost" }).text).toContain("lenSePerdio:Lucía");
  });

  it("«Ver lo que hizo Len» opens his turn", () => {
    paint({ filaId: "f1", status: "done", turn: { id: "f1", userText: "", assistantReasoning: "Listo.", status: "applied" } });
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "verLoQueHizo")!.click());
    expect(on.open).toHaveBeenCalled();
  });
});
