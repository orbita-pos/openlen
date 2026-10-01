import { describe, expect, it, vi } from "vitest";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { enlaceDeVistaPrevia, leerProyecto, listarProyectos, SinRed } from "./proyectos";

const cliente = (r: Response | Error): ClienteDeOpenLen & { pedir: ReturnType<typeof vi.fn> } => ({
  pedir: vi.fn().mockImplementation(() => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r))),
  avisarAlCerrar: vi.fn(),
});

describe("los proyectos desde la app", () => {
  it("lista, de la más reciente a la más vieja", async () => {
    const c = cliente(Response.json({ projects: [
      { id: "a", title: "A", subdomain: null, publishedAt: null, updatedAt: "2026-09-01T00:00:00Z" },
      { id: "b", title: "B", subdomain: "b", publishedAt: "2026-09-02T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
    ] }));
    expect((await listarProyectos(c)).map((p) => p.id)).toEqual(["b", "a"]);
    expect(c.pedir).toHaveBeenCalledWith("/api/projects");
  });

  it("sin red → SinRed (la app enseña «No llego a OpenLen»)", async () => {
    await expect(listarProyectos(cliente(new TypeError("Failed to fetch")))).rejects.toBeInstanceOf(SinRed);
  });

  it("abre un proyecto con su historial y si está publicado", async () => {
    const c = cliente(Response.json({ project: { id: "b", title: "B", subdomain: "b", publishedAt: "2026-09-02T00:00:00Z", chatHistory: [] } }));
    expect(await leerProyecto(c, "b")).toEqual({ id: "b", title: "B", subdomain: "b", publicado: true, historial: [] });
    expect(c.pedir).toHaveBeenCalledWith("/api/projects/b");
  });

  it("la vista previa: activa el enlace (idempotente) y arma /p/<id>?t=", async () => {
    const c = cliente(Response.json({ enabled: true, token: "tok" }));
    expect(await enlaceDeVistaPrevia(c, "http://localhost:3007", "b")).toBe("http://localhost:3007/p/b?t=tok");
    expect(c.pedir).toHaveBeenCalledWith("/api/projects/b/preview", expect.objectContaining({ method: "POST" }));
  });
});
