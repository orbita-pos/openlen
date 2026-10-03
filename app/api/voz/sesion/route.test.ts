import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  dueno: vi.fn(),
  abrir: vi.fn(),
  intentar: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/voz/dueno", () => ({ esDuenoDelProyecto: mocks.dueno }));
vi.mock("@/lib/voz/sesion", () => ({ abrirSesionDeVoz: mocks.abrir }));
vi.mock("@/lib/voz/tope", () => ({ topeDeLlamadas: { intentar: mocks.intentar } }));

import { POST } from "./route";

const pide = (body: unknown) => new Request("http://x/api/voz/sesion", { method: "POST", body: JSON.stringify(body) });
const bueno = { projectId: "p1", sdp: "v=0 oferta", idioma: "es" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENLEN_VOZ = "1";
  process.env.OPENAI_API_KEY = "sk-test";
  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.dueno.mockResolvedValue(true);
  mocks.intentar.mockReturnValue(true);
  mocks.abrir.mockResolvedValue({ ok: true, sdp: "v=0 respuesta", sesionId: "live_1" });
});
afterEach(() => {
  delete process.env.OPENLEN_VOZ;
});

describe("POST /api/voz/sesion", () => {
  it("con todo en orden devuelve la respuesta SDP, el id y el saludo del idioma", async () => {
    const r = await POST(pide(bueno));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ sdp: "v=0 respuesta", sesionId: "live_1" });
    expect(j.saludo).toMatch(/Hola, soy Len/);
    expect(mocks.abrir).toHaveBeenCalledWith(expect.objectContaining({ sdp: "v=0 oferta", apiKey: "sk-test" }));
    expect(mocks.abrir.mock.calls[0]![0].config.voz).toBe("marin");
  });

  it("el interruptor apagado rechaza antes de mirar nada", async () => {
    process.env.OPENLEN_VOZ = "0";
    const r = await POST(pide(bueno));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("voz_apagada");
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("acepta el apagado con espacios alrededor (cmd los deja)", async () => {
    process.env.OPENLEN_VOZ = "0 ";
    expect((await POST(pide(bueno))).status).toBe(503);
  });

  // 🔴 Encendida por defecto (2026-10-03): sin la variable, la llamada se abre.
  it("sin la variable, la voz está encendida", async () => {
    delete process.env.OPENLEN_VOZ;
    expect((await POST(pide(bueno))).status).toBe(200);
  });

  it("sin sesión: 401", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(pide(bueno))).status).toBe(401);
  });

  it("cuerpo sin sdp o sin proyecto: 400", async () => {
    expect((await POST(pide({ projectId: "p1", idioma: "es" }))).status).toBe(400);
    expect((await POST(pide({ sdp: "x", idioma: "es" }))).status).toBe(400);
  });

  it("proyecto ajeno: 404, y no gasta tope ni llama a OpenAI", async () => {
    mocks.dueno.mockResolvedValue(false);
    expect((await POST(pide(bueno))).status).toBe(404);
    expect(mocks.intentar).not.toHaveBeenCalled();
    expect(mocks.abrir).not.toHaveBeenCalled();
  });

  it("tope del día: 429, sin llamar a OpenAI", async () => {
    mocks.intentar.mockReturnValue(false);
    expect((await POST(pide(bueno))).status).toBe(429);
    expect(mocks.abrir).not.toHaveBeenCalled();
  });

  it("si OpenAI falla: 502 con su estado", async () => {
    mocks.abrir.mockResolvedValue({ ok: false, status: 400, motivo: "mal" });
    const r = await POST(pide(bueno));
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "openai", status: 400 });
  });

  it("un idioma raro no rompe: cae a español", async () => {
    await POST(pide({ ...bueno, idioma: "<script>" }));
    expect(mocks.abrir.mock.calls[0]![0].config.voz).toBe("marin");
  });
});
