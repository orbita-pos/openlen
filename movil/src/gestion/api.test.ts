import { describe, expect, it, vi } from "vitest";
import { cargarGestion, publicar, quitarEncargo, pausarEncargo, leerVisitas, urlPublicada, ErrorGestion } from "./api";

const cliente = (responder: (ruta: string, init?: RequestInit) => Response) => ({ pedir: vi.fn(async (r: string, i?: RequestInit) => responder(r, i)), avisarAlCerrar: vi.fn() });
describe("gestión autenticada", () => {
  it("no comparte una vista previa ni una URL insegura, aunque tengan subdominio", () => {
    expect(urlPublicada({ publishedAt: null, deployUrl: "https://pan.openlen.app" })).toBeNull();
    expect(urlPublicada({ publishedAt: "hoy", deployUrl: "javascript:alert(1)" })).toBeNull();
    expect(urlPublicada({ publishedAt: "hoy", deployUrl: "https://pan.openlen.app" })).toBe("https://pan.openlen.app/");
  });
  it("recupera el encargo que el servidor anotó y la dirección de publicación", async () => {
    const goal = { id: "g", objective: "Vender pan", phase: "paused", activation: "disarmed" };
    const c = cliente(() => Response.json({ project: { id: "p", title: "Pan", publishedAt: "hoy", deployUrl: "https://pan.openlen.app", chatHistory: [{ goal }, {}] } }));
    const p = await cargarGestion(c, "p/a");
    expect(p.goal).toEqual(goal);
    expect(p.url).toBe("https://pan.openlen.app/");
    expect(c.pedir).toHaveBeenCalledWith("/api/projects/p%2Fa", expect.anything());
  });
  it("conserva el bloqueo y los hallazgos sin aceptar ni reintentar por su cuenta", async () => {
    const data = { error: "security_findings", fingerprint: "f", blocking: [{ description: "Datos públicos" }] };
    const c = cliente(() => Response.json(data, { status: 428 }));
    await expect(publicar(c, "p", "pan", "es")).rejects.toMatchObject({ status: 428, codigo: "security_findings", datos: data });
    expect(c.pedir).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(c.pedir.mock.calls[0][1]?.body))).toEqual({ subdomain: "pan", locale: "es" });
  });
  it("sólo manda la confirmación explícita asociada a la publicación", async () => {
    const c = cliente(() => Response.json({ url: "https://pan.openlen.app" }));
    await publicar(c, "p", "pan", "es", { acceptSecurityFingerprint: "huella" });
    expect(JSON.parse(String(c.pedir.mock.calls[0][1]?.body))).toEqual({ subdomain: "pan", locale: "es", acceptSecurityFingerprint: "huella" });
  });
  it("conserva errores no JSON y no declara éxito", async () => {
    const c = cliente(() => new Response("offline proxy", { status: 503 }));
    await expect(publicar(c, "p", "pan", "es")).rejects.toBeInstanceOf(ErrorGestion);
  });
  it("consulta visitas con zona y nunca fabrica valores si falla", async () => {
    const c = cliente(() => Response.json({ vistas: 12, personas: 8, hoy: 2, porDia: [], origen: null }));
    expect((await leerVisitas(c, "p/a", "America/Chihuahua")).vistas).toBe(12);
    expect(c.pedir.mock.calls[0][0]).toBe("/api/voz/visitas?project=p%2Fa&zona=America%2FChihuahua");
    await expect(leerVisitas(cliente(() => new Response("", { status: 500 })), "p", "UTC")).rejects.toBeInstanceOf(ErrorGestion);
  });
  it("quitar y pausar mandan las identidades y acciones correctas", async () => {
    const c = cliente(() => Response.json({ ok: true }));
    await quitarEncargo(c, "proyecto");
    await pausarEncargo(c, "turno");
    expect(c.pedir.mock.calls.map(([r, i]) => [r, JSON.parse(String(i?.body))])).toEqual([
      ["/api/agent/encargo", { projectId: "proyecto", action: "clear" }],
      ["/api/agent/cancelar", { turnoId: "turno" }],
    ]);
  });
});
