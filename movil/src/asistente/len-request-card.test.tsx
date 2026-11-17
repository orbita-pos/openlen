import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LenRequestView } from "@/lib/assistants/len-requests";

import { LenRequestCard } from "./len-request-card";

vi.mock("use-intl", () => ({ useTranslations: () => (k: string, v?: Record<string, string>) => (v ? `${k}:${Object.values(v).join(",")}` : k) }));
vi.mock("../entrega/entrega", async (original) => ({ ...(await original<typeof import("../entrega/entrega")>()), Progreso: ({ pasos }: { pasos: unknown[] }) => <div data-pasos={pasos.length} /> }));
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

  // Deferred minors of the final review: «Publicar» with nothing to publish, «terminó» for a stopped turn.
  it("🔴 done without changing the page: what he said, and nothing to compare or publish", () => {
    const { text, buttons } = paint({ filaId: "f1", status: "done", turn: { id: "f1", userText: "", assistantReasoning: "Esta semana entraron 312 personas.", status: "applied", noDocChange: true } });
    expect(text).toContain("lenTermino");
    expect(text).toContain("Esta semana entraron 312 personas.");
    expect(buttons).not.toContain("antesAhora");
    expect(buttons).not.toContain("publicar");
  });

  it("🔴 done on a question: Len asks it here, and «Contestar» opens his turn to answer", () => {
    const asked = { tool: "ask_user_question", status: "done" as const, summary: "", preguntas: [{ id: "q1", question: "¿Azul o verde?", options: [{ label: "Azul" }, { label: "Verde" }] }] };
    const { text, buttons } = paint({ filaId: "f1", status: "done", turn: { id: "f1", userText: "", assistantReasoning: "Antes de cambiarlo:", status: "applied", actions: [asked] } });
    expect(text).toContain("lenPregunta");
    expect(text).toContain("¿Azul o verde?");
    expect(buttons).not.toContain("publicar");
    expect(buttons).not.toContain("antesAhora");
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "contestar")!.click());
    expect(on.open).toHaveBeenCalled();
  });

  it("🔴 stopped: Len stopped, never «terminó», and nothing to publish", () => {
    const { text, buttons } = paint({ filaId: "f1", status: "stopped", turn: { id: "f1", userText: "", assistantReasoning: "Empecé a cambiar", status: "applied", cortado: true, endReason: "cancelled" } });
    expect(text).toContain("lenSeDetuvo");
    expect(text).not.toContain("lenTermino");
    expect(buttons).not.toContain("publicar");
    expect(buttons).toContain("verLoQueHizo");
  });

  it("🔴 its project is gone: it says so, and offers nothing to open", () => {
    act(() =>
      root.render(<LenRequestCard view={{ filaId: "f1", status: "done", turn: { id: "f1", userText: "", assistantReasoning: "Listo.", status: "applied" } }} lenRef={REF} projectTitle="" gone name="Lucía" onStop={on.stop} onCompare={on.compare} onPublish={on.publish} onOpen={on.open} />),
    );
    expect(host.textContent).toContain("proyectoNoEsta");
    expect(host.querySelectorAll("button")).toHaveLength(0);
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
