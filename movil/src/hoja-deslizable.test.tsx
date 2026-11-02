import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHojaDeslizable } from "./hoja-deslizable";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement, medir: (() => void) | null, altoCuerpo: number;
function Prueba({ encogida }: { encogida: boolean }) {
  const ref = useHojaDeslizable({ encogida, alCambiar: () => {} });
  return <div ref={ref}><div className="lm-body" /></div>;
}
beforeEach(() => {
  medir = null; altoCuerpo = 230;
  vi.stubGlobal("ResizeObserver", class { constructor(f: () => void) { medir = f; } observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get(this: HTMLElement) { return this.classList.contains("lm-body") ? altoCuerpo : altoCuerpo + 96; } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight; });

// Cada vez que se pone `--hoja-y`, con qué transición estaba la hoja en ese momento.
function espiar(el: HTMLElement) {
  const puestas: { y: string; transicion: string }[] = [];
  const poner = el.style.setProperty.bind(el.style);
  el.style.setProperty = (p: string, v: string | null, prioridad?: string) => {
    if (p === "--hoja-y") puestas.push({ y: v ?? "", transicion: el.style.transition });
    poner(p, v, prioridad);
  };
  return puestas;
}

it("encogida, si Len escribe y el cuerpo crece, la hoja va a su sitio sin animarse: no se asoma", () => {
  act(() => root.render(<Prueba encogida />));
  const el = host.firstElementChild as HTMLElement;
  expect(el.style.getPropertyValue("--hoja-y")).toBe("230px");
  const puestas = espiar(el);
  altoCuerpo = 278;
  act(() => medir?.());
  expect(puestas).toEqual([{ y: "278px", transicion: "none" }]);
  expect(el.style.transition).toBe("");
});

it("encoger la hoja con el dedo o el botón sigue animándose", () => {
  act(() => root.render(<Prueba encogida={false} />));
  const el = host.firstElementChild as HTMLElement;
  const puestas = espiar(el);
  act(() => root.render(<Prueba encogida />));
  expect(puestas).toEqual([{ y: "230px", transicion: "" }]);
});
