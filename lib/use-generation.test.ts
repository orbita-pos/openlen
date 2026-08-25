import { describe, expect, it, vi } from "vitest";

import { applyEvent, type EventSink, type GenerationState } from "./use-generation";

function drive(raw: string): GenerationState {
  let state: GenerationState = { kind: "idle" };
  const sink: EventSink = {
    setState: (updater) => {
      state = updater(state);
    },
    chunk: vi.fn(),
    flush: vi.fn(),
  };
  applyEvent(raw, sink);
  return state;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}`;
}

describe("la superficie Crear distingue quedarse sin créditos de fallar", () => {
  // 🔴 EL DEFECTO QUE ESTO CIERRA. La página clasificaba TODO error con
  // classifyAiError, que no tiene cubo para créditos: quien se quedaba sin
  // saldo leía «Algo salió mal al generar tu página. Vuelve a intentarlo» y
  // un botón de Reintentar que no podía funcionar. El mensaje bueno existía
  // pero sólo vivía en el atributo title. Ahora el código viaja como dato.
  it("un error de créditos llega marcado, con el instante de renovación", () => {
    const state = drive(
      sse("error", {
        message: "No tienes créditos disponibles.",
        code: "no_credits",
        refillsAt: "2026-09-23T12:00:00.000Z",
      }),
    );

    expect(state).toEqual({
      kind: "error",
      message: "No tienes créditos disponibles.",
      noCredits: { refillsAt: "2026-09-23T12:00:00.000Z" },
    });
  });

  it("sin fecha sigue siendo la puerta de créditos, no un fallo genérico", () => {
    const state = drive(
      sse("error", { message: "No tienes créditos.", code: "no_credits" }),
    );

    expect(state).toEqual({
      kind: "error",
      message: "No tienes créditos.",
      noCredits: { refillsAt: null },
    });
  });

  it("un fallo de verdad NO se disfraza de muro de créditos", () => {
    const state = drive(sse("error", { message: "503 unavailable" }));

    expect(state).toEqual({ kind: "error", message: "503 unavailable" });
    expect("noCredits" in state).toBe(false);
  });

  it("un evento sin data o con JSON roto no toca el estado", () => {
    expect(drive("event: error")).toEqual({ kind: "idle" });
    expect(drive("event: error\ndata: {no-json")).toEqual({ kind: "idle" });
  });
});
