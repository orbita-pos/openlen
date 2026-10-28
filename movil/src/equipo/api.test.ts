import { expect, it, vi } from "vitest";
import { cargarEquipo, accionEquipo } from "./api";
const cliente = (pedir = vi.fn()) => ({ pedir, avisarAlCerrar: vi.fn() });
it("no envía mensajes a /api/agent: usa sólo el puente del móvil", async () => {
  const c = cliente(vi.fn(async () => Response.json({ id: "m1" })));
  await accionEquipo(c, "p/1", { accion: "mensaje", texto: "@Ana hola", menciones: ["a"], idioma: "es" });
  expect(c.pedir).toHaveBeenCalledWith("/api/movil/equipo", expect.objectContaining({ method: "POST", body: JSON.stringify({ projectId: "p/1", accion: "mensaje", texto: "@Ana hola", menciones: ["a"], idioma: "es" }) }));
});
it("codifica proyecto, acepta señal y distingue un servidor sin la ruta", async () => {
  const c = cliente(vi.fn(async () => new Response("<h1>not found</h1>", { status: 404 })));
  const signal = new AbortController().signal;
  await expect(cargarEquipo(c, "a&otro=b", signal)).rejects.toMatchObject({ codigo: "no_disponible" });
  expect(c.pedir).toHaveBeenCalledWith("/api/movil/equipo?project=a%26otro%3Db", { signal });
});
it("no convierte errores de acceso en una lista vacía", async () => {
  const c = cliente(vi.fn(async () => Response.json({ error: "not_found" }, { status: 404 })));
  await expect(cargarEquipo(c, "p")).rejects.toMatchObject({ codigo: "sin_acceso" });
});
