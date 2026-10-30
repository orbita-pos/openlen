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

  it("🔴 la vista previa es el lienzo, como en la web: ahí corre una app", async () => {
    const c = cliente(Response.json({ url: "https://lienzo-abc.openlen.app/?__lienzo=d" }));
    expect(await enlaceDeVistaPrevia(c, "http://localhost:3007", "b")).toBe("https://lienzo-abc.openlen.app/?__lienzo=d");
    expect(c.pedir).toHaveBeenCalledWith("/api/movil/canvas", expect.objectContaining({ method: "POST", body: JSON.stringify({ projectId: "b" }) }));
    expect(c.pedir).not.toHaveBeenCalledWith("/api/projects/b/preview", expect.anything());
  });

  it("sin lienzo (un servidor de antes, o apagado): activa el enlace (idempotente) y arma /p/<id>?t=", async () => {
    for (const sinLienzo of [new Response(null, { status: 404 }), new Response(null, { status: 503 })]) {
      const c: ClienteDeOpenLen & { pedir: ReturnType<typeof vi.fn> } = {
        pedir: vi.fn().mockImplementation((ruta: string) =>
          Promise.resolve(ruta === "/api/movil/canvas" ? sinLienzo.clone() : Response.json({ enabled: true, token: "tok" })),
        ),
        avisarAlCerrar: vi.fn(),
      };
      expect(await enlaceDeVistaPrevia(c, "http://localhost:3007", "b")).toBe("http://localhost:3007/p/b?t=tok");
      expect(c.pedir).toHaveBeenCalledWith("/api/projects/b/preview", expect.objectContaining({ method: "POST" }));
    }
  });

  it("sin red no se inventa un enlace: SinRed, y la pantalla ofrece reintentar", async () => {
    await expect(enlaceDeVistaPrevia(cliente(new TypeError("Failed to fetch")), "http://localhost:3007", "b")).rejects.toBeInstanceOf(SinRed);
  });
});
