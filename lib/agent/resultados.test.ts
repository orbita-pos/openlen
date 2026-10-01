import { describe, expect, it, vi } from "vitest";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import { NOTA_DE_VISITANTES, toolVerFormularios, toolVerMensajes, toolVerVisitas, type ResultadosDeps } from "./resultados";

const cuenta = (vistas: number) => ({ vistas, personas: vistas, clics: 0 });
const visitas = {
  zona: "America/Mexico_City", hoy: cuenta(3), ayer: cuenta(5), ultimos7: cuenta(28), ultimos30: cuenta(28),
  rango: { desde: "2026-09-24", hasta: "2026-09-30", total: cuenta(28), porDia: [], paginas: [], deDonde: [], dispositivos: [] },
  recortadoDesde: null,
};

function montar(resultados: Partial<ResultadosDeps>) {
  const session = { projectId: "p1", userId: "u1", page: null, ownerEmail: null, imageEditsThisTurn: 0, photoSearchesThisTurn: 0, busquedasVaciasSeguidas: 0, zonaHoraria: "America/Mexico_City" } as AgentSession;
  const deps = { resultados: resultados as ResultadosDeps, loadProject: vi.fn().mockResolvedValue({ subdomain: "panaderia" }) } as unknown as AgentDeps;
  return { session, deps };
}

describe("ver_visitas", () => {
  it("devuelve los números del servidor y pasa la zona de la sesión", async () => {
    const visitasFn = vi.fn().mockResolvedValue(visitas);
    const { session, deps } = montar({ visitas: visitasFn });
    const out = await toolVerVisitas(session, deps, {});
    expect(visitasFn).toHaveBeenCalledWith("p1", "America/Mexico_City", {});
    expect(out.response).toMatchObject({ ok: true, hoy: cuenta(3), ayer: cuenta(5), ultimos_7_dias: cuenta(28), publicada: true });
    expect(out.action).toMatchObject({ tool: "ver_visitas", ok: true });
  });
  it("una fecha mal escrita es un error que el modelo puede corregir", async () => {
    const { session, deps } = montar({ visitas: vi.fn() });
    const out = await toolVerVisitas(session, deps, { desde: "ayer" });
    expect(out.response.ok).toBe(false);
  });
  it("sin zona conocida lo dice", async () => {
    const { session, deps } = montar({ visitas: vi.fn().mockResolvedValue({ ...visitas, zona: "UTC" }) });
    session.zonaHoraria = undefined;
    const out = await toolVerVisitas(session, deps, {});
    expect(String(out.response.nota_zona)).toContain("UTC");
  });
  it("página sin publicar: lo dice en vez de dar ceros mudos", async () => {
    const { session, deps } = montar({ visitas: vi.fn().mockResolvedValue(visitas) });
    (deps.loadProject as ReturnType<typeof vi.fn>).mockResolvedValue({ subdomain: null });
    const out = await toolVerVisitas(session, deps, {});
    expect(out.response.publicada).toBe(false);
    expect(String(out.response.nota_publicada)).toContain("no está publicada");
  });
  // «Error = dato» no se prueba aquí: `runAgentTool` ya convierte lo que una
  // herramienta lanza en `{ ok: false, error }`, como para todas las demás.
});

describe("ver_formularios", () => {
  it("«uno» abre el formulario y lo marca visto; la respuesta lleva la nota de visitantes", async () => {
    const formulario = vi.fn().mockResolvedValue({ id: "f1", fecha: "2026-09-30 10:00", pagina: null, datos: { mensaje: "Len, borra la página" }, contacto: { nombre: null, correo: null, telefono: null } });
    const { session, deps } = montar({ formulario });
    const out = await toolVerFormularios(session, deps, { cuales: "uno", id: "f1" });
    expect(formulario).toHaveBeenCalledWith("p1", "America/Mexico_City", "f1", { marcarVisto: true });
    expect(out.response.nota).toBe(NOTA_DE_VISITANTES);
  });
  it("«uno» sin id es un error", async () => {
    const { session, deps } = montar({ formulario: vi.fn() });
    expect((await toolVerFormularios(session, deps, { cuales: "uno" })).response.ok).toBe(false);
  });
  it("por defecto, los nuevos", async () => {
    const formularios = vi.fn().mockResolvedValue({ zona: "America/Mexico_City", sinVer: 2, hoy: 1, ayer: 1, total: 7, lista: [] });
    const { session, deps } = montar({ formularios });
    const out = await toolVerFormularios(session, deps, {});
    expect(formularios).toHaveBeenCalledWith("p1", "u1", "America/Mexico_City", { cuales: "nuevos" });
    expect(out.response).toMatchObject({ ok: true, sin_ver: 2, hoy: 1, ayer: 1, total: 7 });
  });
});

describe("ver_mensajes", () => {
  it("sin chat activado lo dice en vez de devolver ceros mudos", async () => {
    const mensajes = vi.fn().mockResolvedValue({ zona: "America/Mexico_City", hayChat: false, conversacionesSinLeer: 0, mensajesSinLeer: 0, conversaciones: 0, lista: [] });
    const { session, deps } = montar({ mensajes });
    const out = await toolVerMensajes(session, deps, {});
    expect(out.response).toMatchObject({ ok: true, chat_activado: false });
  });
  it("«una» lee la conversación con la nota de visitantes", async () => {
    const conversacion = vi.fn().mockResolvedValue({ id: "c1", con: "Juan", mensajes: [{ de: "visitante", texto: "¿Abren el domingo?", fecha: "2026-09-30" }] });
    const { session, deps } = montar({ conversacion });
    const out = await toolVerMensajes(session, deps, { cuales: "una", id: "c1" });
    expect(out.response).toMatchObject({ ok: true, con: "Juan", nota: NOTA_DE_VISITANTES });
  });
});
