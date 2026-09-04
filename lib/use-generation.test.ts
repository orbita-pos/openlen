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


/**
 * 🔴 LA MEDIDA DEL NAVEGADOR NO LE QUITA LA PÁGINA AL USUARIO.
 *
 * Esto viene de una queja de Jesús sobre PRODUCCIÓN (2026-09-04): la página se
 * terminaba, aparecía «Fixing what the browser measured» por un desborde a
 * 390px, y su página desaparecía mientras se escribía otra encima.
 *
 * Eran dos mitades. En el servidor, una rotura medida autorizaba una
 * REESCRITURA completa —retirada—. Y aquí, `regen-starting` vaciaba el buffer
 * para que el preview no mezclara la versión descartada con la nueva.
 *
 * Sin reescritura detrás, vaciar deja el buffer en "" y nada que lo rellene: la
 * pantalla queda colgando del recuerdo del lienzo para no enseñar un hueco. Eso
 * es sostenerla con la red en vez de con el suelo, y cualquier fallo del
 * recuerdo se lee como «me borró la página» — la queja exacta.
 *
 * `regen-starting` NO estaba cubierto por ninguna prueba, que es como el
 * borrado sobrevivió. Ahora sí.
 */
describe("la medida del navegador no le quita la pagina al usuario", () => {
  const PAGINA = "<!doctype html><html><body><h1>Aurora</h1></body></html>";

  function conducir(estadoInicial: GenerationState, raw: string): GenerationState {
    let state = estadoInicial;
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

  it("conserva el html que el usuario ya esta viendo", () => {
    const state = conducir(
      { kind: "generating", reasoning: "", html: PAGINA },
      sse("medida", {
        reason: "el documento se desborda a lo ancho en movil (390px)",
      }),
    );

    assertGenerating(state);
    expect(state.html, "le quito la pagina de delante").toBe(PAGINA);
  });

  it("y dice QUE se midio, sin traducirlo", () => {
    const state = conducir(
      { kind: "generating", reasoning: "", html: PAGINA },
      sse("medida", {
        reason: "el documento se desborda a lo ancho en movil (390px)",
      }),
    );

    assertGenerating(state);
    // El dato va verbatim: «se desborda a 390px» dice que arreglar, «mejorando
    // el diseño» no dice nada. Ver el comentario del tipo `medido`.
    expect(state.medido).toContain("390px");
  });

  function assertGenerating(
    s: GenerationState,
  ): asserts s is Extract<GenerationState, { kind: "generating" }> {
    expect(s.kind).toBe("generating");
  }
});
