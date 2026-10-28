import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDeslizar } from "./deslizar";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, reducir = false;
function Prueba({ cerrar, activo = true, clave = "p1" }: {cerrar: () => void; activo?: boolean; clave?: string}) { const ref = useDeslizar({ hacia: "derecha", rapido: true, activo, clave, alSoltar: cerrar }); return <div ref={ref}><textarea/><div className="horizontal"><button>Tarjeta</button></div></div>; }
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

it("no arrastra al seleccionar texto en un campo",()=>{
 const cerrar=vi.fn(),el=montar(cerrar),campo=el.querySelector('textarea')!;
 for(const [tipo,x] of [["pointerdown",0],["pointermove",170],["pointerup",170]] as const){const e=new Event(tipo,{bubbles:true,cancelable:true});Object.assign(e,{pointerId:1,pointerType:"touch",clientX:x,clientY:100});act(()=>campo.dispatchEvent(e))}
 act(()=>vi.runAllTimers());expect(cerrar).not.toHaveBeenCalled();expect(el.style.transform).toBe("");
});
it("un carrusel horizontal conserva su gesto y no cierra la pantalla",()=>{
 const cerrar=vi.fn(),el=montar(cerrar),carrusel=el.querySelector<HTMLElement>('.horizontal')!;
 carrusel.style.overflowX='auto';Object.defineProperties(carrusel,{scrollWidth:{value:600},clientWidth:{value:300}});
 for(const [tipo,x] of [["pointerdown",0],["pointermove",170],["pointerup",170]] as const){const e=new Event(tipo,{bubbles:true,cancelable:true});Object.assign(e,{pointerId:1,pointerType:"touch",clientX:x,clientY:100});act(()=>carrusel.firstElementChild!.dispatchEvent(e))}
 act(()=>vi.runAllTimers());expect(cerrar).not.toHaveBeenCalled();
});

it("reintentar tras cancelar no deja que la vuelta anterior corte la salida nueva", () => {
  const cerrar = vi.fn(), el = montar(cerrar);
  for (const [tipo, x] of [["pointerdown", 0], ["pointermove", 30], ["pointercancel", 30]] as const) {
    const e = new Event(tipo, { bubbles: true, cancelable: true });
    Object.assign(e, { pointerId: 1, pointerType: "touch", clientX: x, clientY: 100 });
    act(() => el.dispatchEvent(e));
  }
  act(() => vi.advanceTimersByTime(100)); gesto(el);
  act(() => vi.advanceTimersByTime(110));
  expect(cerrar).not.toHaveBeenCalled(); expect(el.style.transition).toContain(".16s");
  act(() => vi.runAllTimers()); expect(cerrar).toHaveBeenCalledOnce();
});
it("movimiento reducido permite volver a usar el gesto en la misma capa", () => {
  reducir = true; const cerrar = vi.fn(), el = montar(cerrar);
  gesto(el); gesto(el); expect(cerrar).toHaveBeenCalledTimes(2);
});

it("cerrar y reabrir la capa cancela la salida anterior", () => {
  const cerrar = vi.fn(), el = montar(cerrar); gesto(el);
  act(() => root.render(<Prueba cerrar={cerrar} activo={false} />));
  act(() => root.render(<Prueba cerrar={cerrar} activo />));
  act(() => vi.runAllTimers()); expect(cerrar).not.toHaveBeenCalled();
  expect(el.style.transform).toBe(""); gesto(el);
  act(() => vi.runAllTimers()); expect(cerrar).toHaveBeenCalledOnce();
});
it("un proyecto nuevo no recibe el cierre pendiente del anterior", () => {
  const cerrar = vi.fn(), nuevo = vi.fn(), el = montar(cerrar); gesto(el);
  act(() => root.render(<Prueba cerrar={nuevo} clave="p2" />));
  act(() => vi.runAllTimers()); expect(cerrar).not.toHaveBeenCalled(); expect(nuevo).not.toHaveBeenCalled();
  expect(el.style.transform).toBe("");
});
