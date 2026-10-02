// @vitest-environment jsdom
// Los pasos del turno terminado, detrás de una fila (la #13 de
// plans/len-agente-2026/notas/fase-5-taller.md). Arnés manual de react-dom +
// act(), como `terminal-view.test.tsx`.
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { ProcesoPlegable } from "./proceso-plegable";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
});

function montar() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  const pintar = (plegable: boolean) =>
    act(() =>
      root.render(
        <ProcesoPlegable plegable={plegable} titulo="Completado en 1min 4s">
          <button type="button" data-tarjeta="">
            Leyendo la página
          </button>
        </ProcesoPlegable>,
      ),
    );
  return { el, pintar };
}

const fila = (el: HTMLElement) => el.querySelector<HTMLButtonElement>("button[aria-expanded]");
const tarjeta = (el: HTMLElement) => el.querySelector<HTMLButtonElement>("[data-tarjeta]");

describe("ProcesoPlegable — como el pliegue del turno de DeepSeek", () => {
  it("mientras corre (o si se detuvo), los pasos a la vista y sin fila", () => {
    const { el, pintar } = montar();
    pintar(false);
    expect(fila(el)).toBeNull();
    expect(tarjeta(el)).not.toBeNull();
  });

  it("un turno que ya llegó cerrado, plegado: la fila con su título, y se abre y se cierra", () => {
    const { el, pintar } = montar();
    pintar(true);
    expect(fila(el)!.textContent).toBe("Completado en 1min 4s");
    expect(fila(el)!.getAttribute("aria-expanded")).toBe("false");
    expect(tarjeta(el)).toBeNull();
    act(() => fila(el)!.click());
    expect(tarjeta(el)).not.toBeNull();
    act(() => fila(el)!.click());
    expect(tarjeta(el)).toBeNull();
  });

  it("al cerrar el turno se pliega solo, y la tarjeta es la misma de antes hasta entonces", () => {
    const { el, pintar } = montar();
    pintar(false);
    const antes = tarjeta(el);
    pintar(true);
    expect(tarjeta(el)).toBeNull();
    expect(fila(el)!.getAttribute("aria-expanded")).toBe("false");
    act(() => fila(el)!.click());
    expect(tarjeta(el)).not.toBe(antes);
  });

  it("🔴 no se pliega solo si el foco del teclado está dentro: lo escondería", () => {
    const { el, pintar } = montar();
    pintar(false);
    tarjeta(el)!.focus();
    expect(document.activeElement).toBe(tarjeta(el));
    pintar(true);
    expect(tarjeta(el)).not.toBeNull();
    expect(fila(el)!.getAttribute("aria-expanded")).toBe("true");
  });
});
