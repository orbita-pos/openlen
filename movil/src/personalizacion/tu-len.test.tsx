import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createTranslator, IntlProvider, type AbstractIntlMessages } from "use-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TuLen } from "./tu-len";
import { Cara } from "../cara";
import { textosPersonalizacion } from "../textos-personalizacion";
import { aplicarLook, leerLook } from "./preferencia";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../atras", () => ({ useAtras: () => {} }));
beforeAll(async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("requestAnimationFrame", () => 0);
  await import("@/brand/len-cara/cara.js");
});
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host?.remove(); localStorage.clear(); vi.restoreAllMocks(); });
async function montar() {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const cerrar = vi.fn();
  await act(async () => root!.render(<IntlProvider locale="es" messages={{ movil: { personalizacion: textosPersonalizacion.es } }}><Cara estado="reposo" className="cara-global" /><TuLen onCerrar={cerrar} /></IntlProvider>));
  return cerrar;
}
async function pulsar(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find(b => b.getAttribute("aria-label") === label || b.textContent?.trim() === label);
  expect(button, `botón ${label}`).toBeTruthy();
  await act(async () => button!.click());
}
describe("Tu Len con el motor real", () => {
  it("previsualiza sin cambiar otras caras y cancelar no persiste", async () => {
    const cerrar = await montar();
    await pulsar("Chef");
    expect(host.querySelector('.tu-len-preview [data-lk="chef"]')).not.toBeNull();
    expect(host.querySelector('.cara-global [data-lk="chef"]')).toBeNull();
    expect(leerLook(window.LenCara!)).toEqual({ cabeza: "", cara: "" });
    await pulsar("Cancelar");
    expect(cerrar).toHaveBeenCalledOnce();
    expect(localStorage.getItem("len-movil-look")).toBeNull();
  });
  it("aplica accesorios mezclados y actualiza todas las caras", async () => {
    const cerrar = await montar();
    await pulsar("Chef"); await pulsar("Lentes"); await pulsar("Aplicar");
    expect(leerLook(window.LenCara!)).toEqual({ cabeza: "chef", cara: "lentes" });
    expect(host.querySelector('.cara-global [data-lk="chef"]')).not.toBeNull();
    expect(host.querySelector('.cara-global [data-lk="lentes"]')).not.toBeNull();
    expect(cerrar).toHaveBeenCalledOnce();
  });
  it("mantiene abierto el borrador y avisa si guardar falla", async () => {
    const cerrar = await montar(); await pulsar("Chef");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await pulsar("Aplicar");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("No se pudo");
    expect(cerrar).not.toHaveBeenCalled();
    expect(host.querySelector('.cara-global [data-lk="chef"]')).toBeNull();
  });
  it("inicia una cara con el último estado aunque cambie durante la carga", async () => {
    aplicarLook({ cabeza: "chef", cara: "" }, window.LenCara!);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    act(() => {
      flushSync(() => root!.render(<Cara estado="reposo" className="cara-global" />));
      flushSync(() => root!.render(<Cara estado="error" className="cara-global" />));
    });
    await act(async () => {});
    expect(host.firstElementChild?.getAttribute("data-st")).toBe("error");
    expect(host.querySelector('[data-lk="chef"]')).not.toBeNull();
  });
  it("no crea el motor si se desmonta antes de terminar la carga", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    let separado: Element | null = null;
    act(() => {
      flushSync(() => root!.render(<Cara estado="reposo" className="cara-global" />));
      separado = host.firstElementChild;
      root!.unmount(); root = undefined;
    });
    await act(async () => {});
    expect(separado!.querySelector("svg")).toBeNull();
  });
  it("cierra con Escape sin guardar y mantiene el foco en el diálogo", async () => {
    const cerrar = await montar(); await pulsar("Chef");
    const primero = host.querySelector<HTMLButtonElement>(".tu-len-close")!;
    const ultimo = host.querySelector<HTMLButtonElement>(".tu-len-apply")!;
    expect(document.activeElement).toBe(primero);
    act(() => primero.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(ultimo);
    act(() => ultimo.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(cerrar).toHaveBeenCalledOnce();
    expect(localStorage.getItem("len-movil-look")).toBeNull();
  });
  it("traduce todas las opciones del catálogo real en los diez idiomas", () => {
    for (const [locale, messages] of Object.entries(textosPersonalizacion)) {
      const errores: unknown[] = [];
      const t = createTranslator({ locale, messages: messages as AbstractIntlMessages, onError: e => errores.push(e) }) as (key: string) => string;
      for (const look of window.LenCara!.LOOKS) expect(t(`looks.${look.id}`)).not.toBe("");
      for (const key of Object.keys(window.LenCara!.HEAD)) expect(t(`cabezas.${key}`)).not.toBe("");
      for (const key of Object.keys(window.LenCara!.FACE)) expect(t(`caras.${key}`)).not.toBe("");
      expect(errores, locale).toEqual([]);
    }
  });
});
