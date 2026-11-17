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

// Len móvil is her app (spec local 2026-11-16-movil-es-tu-asistente, §5.6): beside each project, what it is to her.
it("shows what each project is to her, beside it", () => {
 previo = document.createElement("button"); document.body.append(previo);
 host = document.createElement("div"); document.body.append(host); root = createRoot(host);
 act(() => root.render(<Selector proyectos={[{ id: "p1", title: "Pan" } as never, { id: "p2", title: "Café" } as never]} actual="p1" onElegir={vi.fn()} onCerrar={vi.fn()} onSalir={vi.fn()}
   junto={(p) => (p.id === "p2" ? <span data-libre="">libre</span> : null)} />));
 expect(host.querySelector('[data-junto="p2"] [data-libre]')?.textContent).toBe("libre");
 expect(host.querySelectorAll("[data-junto]")).toHaveLength(1);
});
