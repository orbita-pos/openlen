import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDeslizar } from "./deslizar";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, reducir = false;
function Prueba({ cerrar }: {cerrar: () => void}) { const ref = useDeslizar({ hacia: "derecha", alSoltar: cerrar }); return <div ref={ref} />; }
beforeEach(() => { vi.useFakeTimers(); reducir = false; vi.stubGlobal("matchMedia", () => ({ matches: reducir })); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { if (root) act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function montar(cerrar: () => void) {
  act(() => root.render(<Prueba cerrar={cerrar} />)); const el = host.firstElementChild as HTMLElement;
  Object.defineProperty(el, "offsetWidth", {value: 390}); el.getBoundingClientRect = () => ({width:390} as DOMRect); return el;
}
function gesto(el: HTMLElement) {
  for (const [tipo, x] of [["pointerdown",0],["pointermove",160],["pointerup",160]] as const) {
    const e = new Event(tipo, { bubbles:true, cancelable:true }); Object.assign(e, {pointerId:1,pointerType:"touch",clientX:x,clientY:100}); act(() => el.dispatchEvent(e));
  }
}
it("reducir movimiento completa el gesto al soltar sin esperar una animación", () => {
  reducir = true; const cerrar = vi.fn(); gesto(montar(cerrar)); expect(cerrar).toHaveBeenCalledOnce();
});
it("salir de la pantalla cancela el cierre retrasado del gesto", () => {
  const cerrar = vi.fn(); gesto(montar(cerrar)); expect(cerrar).not.toHaveBeenCalled();
  act(() => root.unmount()); root = undefined as unknown as Root; act(() => vi.runAllTimers()); expect(cerrar).not.toHaveBeenCalled();
});
