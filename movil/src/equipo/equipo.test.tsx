import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Equipo } from "./equipo";
import type { ControlEquipo } from "./use-equipo";
vi.mock("use-intl", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("../atras", () => ({ useAtras: () => {} }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); });
const control = (): ControlEquipo => ({
  datos: { yo: "u1", rol: "lector", puedeLen: false, personas: [{ userId: "u1", nombre: "Ana", rol: "lector" }, { userId: "u2", nombre: "Luis", rol: "editor" }], mensajes: [{ id: "m", autorId: "u2", autor: "Luis", texto: "@Ana revisa", fecha: 1000, fotos: [] }], hilos: [] },
  texto: "", error: null, cargando: false, ocupado: false, esperandoLen: false, pestana: "mensajes", hilo: null,
  cambiarTexto: vi.fn(), cambiarPestana: vi.fn(), abrirHilo: vi.fn(), cerrarHilo: vi.fn(), cambiarEstado: vi.fn(async () => true), recargar: vi.fn(async () => {}), enviar: vi.fn(async () => true),
});
async function montar(e: ControlEquipo, cerrar = vi.fn()) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Equipo equipo={e} titulo="Panadería" idioma="es" onCerrar={cerrar} />));
}
it("identifica al autor del mensaje y avisa que el proyecto lo ve", async () => {
  await montar(control());
  expect(host.querySelector('.eq-mensaje header b')?.textContent).toBe("Luis");
  expect(host.querySelector('.eq-publico')?.textContent).toBe("publico");
  expect(host.querySelector('[data-mencion="persona"]')?.textContent).toBe("@Ana");
});
it("un lector no resuelve hilos de otra persona ni ve @Len en el selector", async () => {
  const e = control(); e.pestana = "hilos"; e.texto = "@";
  e.hilo = { id: "h", creadoPor: "u2", ruta: "/index.html", linea: 2, codigo: "<img onerror=alert(1)>", createdAt: "2026-10-27", estado: "abierto", sinVer: 0, mensajes: [] };
  await montar(e);
  expect(host.querySelector('.eq-estado')).toBeNull(); expect(host.querySelector('img')).toBeNull();
  expect([...host.querySelectorAll('[role="option"]')].some(x => x.textContent?.includes("@Len"))).toBe(false);
  expect(host.querySelector('textarea')).not.toBeNull();
});
it("un servidor sin el puente muestra el error real y permite reintentar", async () => {
  const e = control(); e.datos = null; e.error = "no_disponible";
  await montar(e); expect(host.querySelector('[role="alert"]')?.textContent).toContain("noDisponible");
  expect(host.querySelector('.eq-vacio')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('.eq-error button')!.click()); expect(e.recargar).toHaveBeenCalled();
});
it("muestra que Len trabaja mientras su respuesta de hilo sigue pendiente", async () => {
  const e = control(); e.esperandoLen = true;
  e.hilo = { id: "h", creadoPor: "u2", ruta: "/index.html", linea: 2, codigo: "", createdAt: "2026-10-27", estado: "abierto", sinVer: 0, mensajes: [] };
  e.pestana = "hilos";
  await montar(e);
  expect(host.querySelector('[role="status"]')?.textContent).toBe("avance.trabajando");
});
it("Escape primero cierra las sugerencias, después el panel", async () => {
  const e = control(); e.texto = "@"; const cerrar = vi.fn(); await montar(e, cerrar);
  const campo = host.querySelector('textarea')!;
  act(() => campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(cerrar).not.toHaveBeenCalled();
  act(() => campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(cerrar).toHaveBeenCalledOnce();
});
