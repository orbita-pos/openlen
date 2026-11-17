import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Selector } from "./selector";
vi.mock("use-intl", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("../deslizar", () => ({ useDeslizar: () => null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, previo: HTMLButtonElement;
afterEach(() => { act(() => root.unmount()); host.remove(); previo.remove(); });
it("enfoca el selector, mantiene Tab dentro y permite cerrarlo con Escape", () => {
 previo = document.createElement("button"); document.body.append(previo); previo.focus();
 host = document.createElement("div"); document.body.append(host); root = createRoot(host); const cerrar = vi.fn();
 act(() => root.render(<Selector proyectos={[{ id: "p1", title: "Página" } as never]} actual="p1" onElegir={vi.fn()} onCerrar={cerrar} onSalir={vi.fn()} />));
 const dialogo = host.querySelector<HTMLElement>('[role="dialog"]')!;
 expect(dialogo.contains(document.activeElement)).toBe(true); expect(dialogo.getAttribute('aria-modal')).toBe('true');
 const botones = dialogo.querySelectorAll<HTMLButtonElement>('button'); botones[botones.length-1].focus();
 act(() => botones[botones.length-1].dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', bubbles:true, cancelable:true })));
 expect(document.activeElement).toBe(botones[0]);
 act(() => dialogo.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true })));
 expect(cerrar).toHaveBeenCalledOnce();
});

it("permite abrir cada proyecto desde una fila que también muestra quién lo atiende", () => {
 previo = document.createElement("button"); document.body.append(previo);
 host = document.createElement("div"); document.body.append(host); root = createRoot(host);
 const elegir = vi.fn();
 act(() => root.render(<Selector proyectos={[{ id: "p1", title: "Pan" } as never, { id: "p2", title: "Café" } as never]} actual="p1" onElegir={elegir} onCerrar={vi.fn()} onSalir={vi.fn()}
   descripcion={(p) => p.id === "p1" ? "Lo atiende Lucía" : "Sin asistente"} />));
 const filas = host.querySelectorAll<HTMLButtonElement>(".app-selector-lista button");
 expect(filas).toHaveLength(2);
 expect(filas[0]?.getAttribute("aria-current")).toBe("page");
 expect(filas[0]?.textContent).toContain("Lo atiende Lucía");
 expect(filas[1]?.textContent).toContain("Sin asistente");
 act(() => filas[1]?.click());
 expect(elegir).toHaveBeenCalledWith("p2");
});
