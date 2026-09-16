import { describe, expect, it } from "vitest";
import { INICIAL, motivoDeRespuesta, siguiente, type EstadoLienzo } from "./lienzo-remoto";

const remoto = (extra: Partial<Extract<EstadoLienzo, { modo: "remoto" }>> = {}): EstadoLienzo => ({
  modo: "remoto", url: "http://l/1", listo: false, reintentado: false, ...extra,
});

describe("la máquina del lienzo remoto", () => {
  it("esperando → subido → remoto sin listo", () => {
    expect(siguiente(INICIAL, { tipo: "subido", url: "http://l/1", reintento: false }).estado).toEqual(remoto());
  });

  it("el iframe dice listo", () => {
    expect(siguiente(remoto(), { tipo: "listo" }).estado).toEqual(remoto({ listo: true }));
  });

  it("vence el plazo sin listo: se sube OTRA VEZ, una sola", () => {
    const p = siguiente(remoto(), { tipo: "vencido" });
    expect(p.subirOtraVez).toBe(true);
    const tras = siguiente(p.estado, { tipo: "subido", url: "http://l/2", reintento: true });
    expect(tras.estado).toEqual(remoto({ url: "http://l/2", reintentado: true }));
    expect(siguiente(tras.estado, { tipo: "vencido" })).toEqual({
      estado: { modo: "local", motivo: "no_respondio" },
      subirOtraVez: false,
    });
  });

  it("vencer cuando ya dijo listo no hace nada", () => {
    expect(siguiente(remoto({ listo: true }), { tipo: "vencido" })).toEqual({ estado: remoto({ listo: true }), subirOtraVez: false });
  });

  it("recargar el iframe vuelve a exigir listo, con su reintento", () => {
    expect(siguiente(remoto({ listo: true, reintentado: true }), { tipo: "recargado" }).estado).toEqual(remoto());
  });

  it("un fallo lleva a local, y local se queda", () => {
    const local = siguiente(remoto(), { tipo: "fallo", motivo: "apagado" }).estado;
    expect(local).toEqual({ modo: "local", motivo: "apagado" });
    expect(siguiente(local, { tipo: "subido", url: "http://l/3", reintento: false }).estado).toEqual(local);
  });

  it("la respuesta del POST se traduce a motivo", () => {
    expect(motivoDeRespuesta(503, "apagado")).toBe("apagado");
    expect(motivoDeRespuesta(503, "sin_host")).toBe("sin_host");
    expect(motivoDeRespuesta(413, "demasiado_grande")).toBe("demasiado_grande");
    expect(motivoDeRespuesta(500, undefined)).toBe("error");
  });
});
