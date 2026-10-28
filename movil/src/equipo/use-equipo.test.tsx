import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEquipo } from "./use-equipo";
import type { DatosEquipo } from "./tipos";
const m = vi.hoisted(() => ({ cargar: vi.fn(), accion: vi.fn(), len: vi.fn(), cambio: vi.fn(), turno: vi.fn() }));
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), cargarEquipo: m.cargar, accionEquipo: m.accion }));
vi.mock("../api/proyectos", () => ({ leerTurno: m.turno }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cliente = { pedir: vi.fn(), avisarAlCerrar: vi.fn() };
const datos: DatosEquipo = { yo: "u1", rol: "editor", puedeLen: true, personas: [{ userId: "u1", nombre: "Ana", rol: "editor" }, { userId: "u2", nombre: "Luis", rol: "lector" }], mensajes: [], hilos: [{ id: "h1", ruta: "/index.html", linea: 1, codigo: "<h1>Hola</h1>", estado: "abierto", creadoPor: "u1", createdAt: "2026-10-27", sinVer: 0, mensajes: [] }] };
let root: Root; let host: HTMLDivElement; let control: ReturnType<typeof useEquipo>;
function Harness({ id = "p1", activo = true }: { id?: string; activo?: boolean }) {
  control = useEquipo({ cliente, projectId: id, activo, idioma: "es", alPedirLen: m.len, alCambiar: m.cambio });
  return null;
}
beforeEach(() => { vi.clearAllMocks(); m.cargar.mockResolvedValue(datos); m.accion.mockResolvedValue({ id: "m" }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
it("se carga sólo al abrir y no acepta una respuesta tardía del proyecto anterior", async () => {
  let terminar!: (d: DatosEquipo) => void;
  m.cargar.mockImplementationOnce(() => new Promise(r => { terminar = r; }));
  await act(async () => root.render(<Harness activo={false} />)); expect(m.cargar).not.toHaveBeenCalled();
  await act(async () => root.render(<Harness />));
  await act(async () => root.render(<Harness id="p2" />)); expect(control.datos?.yo).toBe("u1");
  await act(async () => terminar({ ...datos, yo: "usuario-viejo" })); expect(control.datos?.yo).toBe("u1");
});
it("un mensaje a persona no llama a Len y conserva el texto si falla", async () => {
  await act(async () => root.render(<Harness />));
  act(() => control.cambiarTexto("@Luis hola"));
  m.accion.mockRejectedValueOnce(new Error("sin red"));
  await act(async () => { expect(await control.enviar()).toBe(false); });
  expect(control.texto).toBe("@Luis hola"); expect(m.len).not.toHaveBeenCalled();
  await act(async () => { expect(await control.enviar()).toBe(true); });
  expect(control.texto).toBe("");
  expect(m.accion).toHaveBeenCalledWith(cliente, "p1", expect.objectContaining({ accion: "mensaje", menciones: ["u2"] }));
});
it("dos toques durante el envío producen una sola escritura", async () => {
  await act(async () => root.render(<Harness />)); act(() => control.cambiarTexto("@Luis revisa"));
  let terminar!: (r: object) => void;
  m.accion.mockImplementation((_: unknown, __: unknown, b: { accion: string }) => b.accion === "mensaje" ? new Promise(r => { terminar = r; }) : Promise.resolve({}));
  let envio!: Promise<boolean>;
  act(() => { envio = control.enviar(); void control.enviar(); });
  expect(m.accion.mock.calls.filter(c => c[2].accion === "mensaje")).toHaveLength(1);
  await act(async () => { terminar({ id: "m" }); await envio; });
});
it("un lector puede responder pero no dirigir trabajo a Len", async () => {
  m.cargar.mockResolvedValue({ ...datos, rol: "lector", puedeLen: false });
  await act(async () => root.render(<Harness />)); act(() => { control.abrirHilo("h1"); });
  act(() => control.cambiarTexto("@Len cambia esto"));
  await act(async () => { expect(await control.enviar()).toBe(false); });
  expect(control.error).toBe("solo_lectura"); expect(m.len).not.toHaveBeenCalled();
  act(() => control.cambiarTexto("Lo reviso mañana"));
  await act(async () => { expect(await control.enviar()).toBe(true); });
  expect(m.accion).toHaveBeenCalledWith(cliente, "p1", expect.objectContaining({ accion: "respuesta", hiloId: "h1", len: false }));
});
it("conserva un borrador independiente por proyecto y por hilo", async () => {
  await act(async () => root.render(<Harness />)); act(() => control.cambiarTexto("@Luis A"));
  act(() => control.abrirHilo("h1")); act(() => control.cambiarTexto("respuesta A"));
  act(() => control.cambiarPestana("mensajes")); expect(control.texto).toBe("@Luis A");
  await act(async () => root.render(<Harness id="p2" />)); expect(control.texto).toBe("");
  act(() => control.cambiarTexto("@Luis B")); await act(async () => root.render(<Harness />)); expect(control.texto).toBe("@Luis A");
});
it("sigue un pedido a Len aunque la fila todavía no exista al responder el hilo", async () => {
  vi.useFakeTimers();
  m.accion.mockImplementation(async (_: unknown, __: unknown, b: { accion: string }) => b.accion === "respuesta" ? { filaId: "fila-tardia" } : {});
  m.turno.mockRejectedValueOnce(new Error("todavía en cola"))
    .mockResolvedValueOnce({ turno: { id: "fila-tardia", status: "applied", enCurso: true, assistantReasoning: "Voy…" } })
    .mockResolvedValue({ turno: { id: "fila-tardia", status: "applied", userText: "cambia", assistantReasoning: "Listo" } });
  await act(async () => root.render(<Harness />)); act(() => control.abrirHilo("h1")); act(() => control.cambiarTexto("@Len cambia el horario"));
  await act(async () => { await control.enviar(); });
  expect(m.turno).toHaveBeenCalledWith(cliente, "fila-tardia");
  m.cambio.mockClear();
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(m.cambio).toHaveBeenCalledWith(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(m.cambio).toHaveBeenCalledWith(true);
});
