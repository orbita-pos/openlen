import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { ModePicker } from "./mode-picker";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
// Como en mando-esfuerzo.test.tsx: el traductor devuelve la CLAVE.
const t = (clave: string) => clave;

function montar(props: Partial<Parameters<typeof ModePicker>[0]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(<ModePicker mode="len" onChange={() => undefined} abierto onAbrir={() => undefined} t={t} {...props} />);
  });
  return host;
}

const opciones = (host: HTMLElement) => [...host.querySelectorAll('[role="menuitemradio"]')] as HTMLButtonElement[];
const disparador = (host: HTMLElement) => host.querySelector("button[aria-haspopup]") as HTMLButtonElement;

afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
});

describe("el selector «Len» / «Len Dynamis»", () => {
  it("ofrece los dos, Len primero, cada uno con lo que hace", () => {
    const textos = opciones(montar()).map((b) => b.textContent ?? "");
    expect(textos).toHaveLength(2);
    expect(textos[0]).toContain("composer.modeLen");
    expect(textos[0]).toContain("composer.modeLenDesc");
    expect(textos[1]).toContain("composer.modeDynamis");
    expect(textos[1]).toContain("composer.modeDynamisDesc");
  });

  it("el botón dice qué Len trabajará, y marca el elegido", () => {
    const host = montar({ mode: "dynamis" });
    expect(disparador(host).textContent).toContain("composer.modeDynamis");
    const marcados = opciones(host).filter((b) => b.getAttribute("aria-checked") === "true");
    expect(marcados).toHaveLength(1);
    expect(marcados[0]?.textContent).toContain("composer.modeDynamis");
  });

  it("elegir avisa del modo y cierra el menú", () => {
    const onChange = vi.fn();
    const onAbrir = vi.fn();
    const host = montar({ onChange, onAbrir });
    act(() => {
      opciones(host)[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("dynamis");
    expect(onAbrir).toHaveBeenCalledWith(false);
  });

  it("cerrado no pinta el menú, sólo el botón", () => {
    const host = montar({ abierto: false });
    expect(opciones(host)).toHaveLength(0);
    expect(disparador(host).textContent).toContain("composer.modeLen");
  });

  it("Esc cierra sin elegir (el gancho compartido de los mandos)", () => {
    const onChange = vi.fn();
    const onAbrir = vi.fn();
    const host = montar({ onChange, onAbrir });
    act(() => {
      opciones(host)[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onAbrir).toHaveBeenCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
