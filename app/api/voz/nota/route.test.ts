// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  dueno: vi.fn(),
  transcribir: vi.fn(),
  intentar: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/voz/dueno", () => ({ esDuenoDelProyecto: mocks.dueno }));
vi.mock("@/lib/voz/transcribir", () => ({ transcribirNota: mocks.transcribir }));
vi.mock("@/lib/voz/tope", () => ({ topeDeNotas: { intentar: mocks.intentar } }));

import { POST } from "./route";

function pide(o: { audio?: Blob | null; projectId?: string; idioma?: string } = {}): Request {
  const f = new FormData();
  const audio = o.audio === undefined ? new Blob([new Uint8Array(2000)], { type: "audio/webm;codecs=opus" }) : o.audio;
  if (audio) f.append("audio", audio, "nota.webm");
  f.append("projectId", o.projectId ?? "p1");
  f.append("idioma", o.idioma ?? "es");
  f.append("segundos", "4");
  return new Request("http://x/api/voz/nota", { method: "POST", body: f });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENLEN_VOZ = "1";
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.OPENLEN_VOZ_NOTA_MODELO;
  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.dueno.mockResolvedValue(true);
  mocks.intentar.mockReturnValue(true);
  mocks.transcribir.mockResolvedValue({ ok: true, texto: "Pon el horario" });
});
afterEach(() => {
  delete process.env.OPENLEN_VOZ;
});

describe("POST /api/voz/nota", () => {
  it("con todo en orden devuelve el texto", async () => {
    const r = await POST(pide());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ texto: "Pon el horario" });
    const llamada = mocks.transcribir.mock.calls[0]![0];
    expect(llamada).toMatchObject({ idioma: "es", modelo: "gpt-4o-mini-transcribe", apiKey: "sk-test" });
    expect(llamada.audio.size).toBe(2000);
  });

  it("el modelo se cambia con OPENLEN_VOZ_NOTA_MODELO", async () => {
    process.env.OPENLEN_VOZ_NOTA_MODELO = "whisper-1";
    await POST(pide());
    expect(mocks.transcribir.mock.calls[0]![0].modelo).toBe("whisper-1");
  });

  it("un idioma que no es de dos letras cae en «es»", async () => {
    await POST(pide({ idioma: "español" }));
    expect(mocks.transcribir.mock.calls[0]![0].idioma).toBe("es");
  });

  it("el interruptor apagado rechaza antes de mirar nada", async () => {
    process.env.OPENLEN_VOZ = "0";
    const r = await POST(pide());
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("voz_apagada");
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("sin sesión ni llave: 401", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(pide())).status).toBe(401);
  });

  it("sin audio, o algo que no es audio: 400", async () => {
    expect((await POST(pide({ audio: null }))).status).toBe(400);
    expect((await POST(pide({ audio: new Blob(["hola"], { type: "text/plain" }) }))).status).toBe(400);
    expect(mocks.transcribir).not.toHaveBeenCalled();
  });

  it("más de 3 MB: 413", async () => {
    const r = await POST(pide({ audio: new Blob([new Uint8Array(3 * 1024 * 1024 + 1)], { type: "audio/webm" }) }));
    expect(r.status).toBe(413);
    expect(mocks.transcribir).not.toHaveBeenCalled();
  });

  it("una página que no es tuya: 404, y no se gasta nada", async () => {
    mocks.dueno.mockResolvedValue(false);
    expect((await POST(pide())).status).toBe(404);
    expect(mocks.transcribir).not.toHaveBeenCalled();
  });

  it("sin clave de OpenAI: 503", async () => {
    delete process.env.OPENAI_API_KEY;
    expect((await POST(pide())).status).toBe(503);
  });

  it("pasado el tope del día: 429, y no se gasta nada", async () => {
    mocks.intentar.mockReturnValue(false);
    const r = await POST(pide());
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe("tope_del_dia");
    expect(mocks.transcribir).not.toHaveBeenCalled();
  });

  it("OpenAI falla: 502 con su status", async () => {
    mocks.transcribir.mockResolvedValue({ ok: false, status: 400, motivo: "x" });
    const r = await POST(pide());
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "openai", status: 400 });
  });
});
