// «Volver a la app» tras el navegador del sistema (spec local 2026-11-17-oauth-de-conectores-mcp, §10.1): en el teléfono
// lo dice Capacitor (`appStateChange`), no el `focus` de una ventana que ahí no existe de verdad; en el navegador de la PC
// (desarrollo) quedan el foco y la visibilidad.
import { describe, expect, it, vi } from "vitest";

import { volverAlPrimerPlano, type DepsDeVolver } from "./volver";

function deps(enWeb: boolean) {
  const nativos: { fn: (e: { isActive: boolean }) => void; quitado: boolean }[] = [];
  const ventana = new EventTarget();
  const documento = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const d: DepsDeVolver = {
    enWeb,
    escucharEstadoDeLaApp: async (fn) => {
      const o = { fn, quitado: false };
      nativos.push(o);
      return { remove: async () => void (o.quitado = true) };
    },
    ventana,
    documento,
  };
  return { d, nativos, ventana, documento };
}

describe("volverAlPrimerPlano", () => {
  it("🔴 en el teléfono oye el estado de la app de Capacitor, y sólo al pasar a activa", async () => {
    const { d, nativos, ventana } = deps(false);
    const fn = vi.fn();
    const quitar = volverAlPrimerPlano(d, fn);
    await Promise.resolve();
    expect(nativos).toHaveLength(1);
    nativos[0]!.fn({ isActive: false });
    expect(fn).not.toHaveBeenCalled();
    nativos[0]!.fn({ isActive: true });
    expect(fn).toHaveBeenCalledTimes(1);
    // El foco de la ventana no cuenta en el teléfono.
    ventana.dispatchEvent(new Event("focus"));
    expect(fn).toHaveBeenCalledTimes(1);
    quitar();
    await Promise.resolve();
    await Promise.resolve();
    expect(nativos[0]!.quitado).toBe(true);
  });

  it("quitar antes de que el oyente exista también lo quita", async () => {
    const { d, nativos } = deps(false);
    volverAlPrimerPlano(d, vi.fn())();
    await new Promise((r) => setTimeout(r, 0));
    expect(nativos[0]!.quitado).toBe(true);
  });

  it("un oyente que no se pudo poner no rompe nada", async () => {
    const { d } = deps(false);
    d.escucharEstadoDeLaApp = () => Promise.reject(new Error("sin plugin"));
    const quitar = volverAlPrimerPlano(d, vi.fn());
    await new Promise((r) => setTimeout(r, 0));
    expect(() => quitar()).not.toThrow();
  });

  it("en el navegador de la PC usa el foco y la visibilidad, y quitar los suelta", () => {
    const { d, nativos, ventana, documento } = deps(true);
    const fn = vi.fn();
    const quitar = volverAlPrimerPlano(d, fn);
    expect(nativos).toEqual([]);
    ventana.dispatchEvent(new Event("focus"));
    expect(fn).toHaveBeenCalledTimes(1);
    documento.visibilityState = "hidden";
    documento.dispatchEvent(new Event("visibilitychange"));
    expect(fn).toHaveBeenCalledTimes(1);
    documento.visibilityState = "visible";
    documento.dispatchEvent(new Event("visibilitychange"));
    expect(fn).toHaveBeenCalledTimes(2);
    quitar();
    ventana.dispatchEvent(new Event("focus"));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
