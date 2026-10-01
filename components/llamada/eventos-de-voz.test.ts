import { describe, expect, it, vi } from "vitest";
import { despacharEventoDeVoz, type ManejadoresDeVoz } from "./eventos-de-voz";

const m = (): ManejadoresDeVoz => ({
  empezo: vi.fn(), oyo: vi.fn(), dijo: vi.fn(), delego: vi.fn(), uso: vi.fn(), cerro: vi.fn(), error: vi.fn(),
});

describe("despacharEventoDeVoz", () => {
  it("cada evento de GPT-Live a su manejador", () => {
    const h = m();
    despacharEventoDeVoz({ type: "session.started", session: { id: "s" } }, h);
    despacharEventoDeVoz({ type: "session.input_transcript.delta", delta: "Hola", start_ms: 600, end_ms: 800 }, h);
    despacharEventoDeVoz({ type: "session.output_transcript.delta", delta: "Hola, soy Len", start_ms: 900, end_ms: 1500 }, h);
    despacharEventoDeVoz({ type: "session.delegation.created", delegation: { id: "d1", type: "delegation", target: "client" } }, h);
    despacharEventoDeVoz({ type: "session.usage.updated", usage: { seconds: 15 } }, h);
    despacharEventoDeVoz({ type: "session.closed", reason: "close_requested", usage: { seconds: 48 } }, h);
    despacharEventoDeVoz({ type: "error", error: { message: "mal" } }, h);
    expect(h.empezo).toHaveBeenCalled();
    expect(h.oyo).toHaveBeenCalledWith("Hola", 600);
    expect(h.dijo).toHaveBeenCalledWith("Hola, soy Len", 900);
    expect(h.delego).toHaveBeenCalledWith("d1");
    expect(h.uso).toHaveBeenCalledWith(15);
    expect(h.cerro).toHaveBeenCalledWith("close_requested", 48);
    expect(h.error).toHaveBeenCalledWith("mal");
  });

  it("lo desconocido o roto se ignora sin romper", () => {
    const h = m();
    for (const e of [null, "x", { type: "session.thinking.appended" }, { type: "session.delegation.created" }]) despacharEventoDeVoz(e, h);
    expect(Object.values(h).every((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true);
  });
});
