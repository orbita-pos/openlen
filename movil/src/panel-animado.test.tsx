import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PanelAnimado } from "./panel-animado";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, reducir = false;
beforeEach(() => {
  vi.useFakeTimers(); reducir = false;
  vi.stubGlobal("matchMedia", () => ({ matches: reducir, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const pintar = (texto: string | null, contexto = "p1") => act(() => root.render(<PanelAnimado contexto={contexto} nivel={70}>{texto ? <button>{texto}</button> : null}</PanelAnimado>));
it("conserva la última pantalla durante la salida, inerte y oculta para lectores", () => {
  pintar("Equipo"); pintar(null);
  const capa = host.querySelector(".app-panel-motion")!;
  expect(capa.textContent).toBe("Equipo"); expect(capa.hasAttribute("inert")).toBe(true); expect(capa.getAttribute("aria-hidden")).toBe("true");
  act(() => vi.advanceTimersByTime(220)); expect(host.textContent).toBe("");
});
it("reabrir antes de acabar cancela el cierre y conserva la pantalla nueva", () => {
  pintar("Equipo"); pintar(null); act(() => vi.advanceTimersByTime(90)); pintar("Gestion");
  act(() => vi.advanceTimersByTime(1000)); expect(host.textContent).toBe("Gestion"); expect(host.querySelector("[inert]")).toBeNull();
});
it("un cambio de proyecto nunca conserva la pantalla anterior", () => {
  pintar("Proyecto uno"); pintar(null, "p2"); expect(host.textContent).toBe("");
});
it("con movimiento reducido cierra sin retener un panel invisible", () => {
  reducir = true; pintar("Equipo"); pintar(null); expect(host.textContent).toBe(""); expect(vi.getTimerCount()).toBe(0);
});
