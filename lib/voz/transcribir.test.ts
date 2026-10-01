// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { transcribirNota, URL_DE_TRANSCRIPCION } from "./transcribir";

const audio = () => new Blob([new Uint8Array(100)], { type: "audio/webm;codecs=opus" });
const responde = (status: number, cuerpo: unknown) => vi.fn(async () => new Response(JSON.stringify(cuerpo), { status }));

describe("transcribirNota", () => {
  it("manda el audio con su modelo e idioma y devuelve el texto limpio", async () => {
    const f = responde(200, { text: "  Pon el horario de la tarde  " });
    const r = await transcribirNota({ audio: audio(), idioma: "es", modelo: "m-1", apiKey: "sk-x", fetch: f });
    expect(r).toEqual({ ok: true, texto: "Pon el horario de la tarde" });
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(URL_DE_TRANSCRIPCION);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-x");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("m-1");
    expect(form.get("language")).toBe("es");
    expect(form.get("response_format")).toBe("json");
    expect((form.get("file") as File).name).toBe("nota.webm");
  });

  it("un audio mp4 (iPhone) lleva su extensión: OpenAI decide el formato por ella", async () => {
    const f = responde(200, { text: "hola" });
    await transcribirNota({ audio: new Blob([new Uint8Array(10)], { type: "audio/mp4" }), idioma: "en", modelo: "m", apiKey: "k", fetch: f });
    const form = (f.mock.calls[0]! as unknown as [string, RequestInit])[1].body as FormData;
    expect((form.get("file") as File).name).toBe("nota.m4a");
  });

  it("un error de OpenAI vuelve como dato, con su mensaje", async () => {
    const r = await transcribirNota({ audio: audio(), idioma: "es", modelo: "m", apiKey: "k", fetch: responde(400, { error: { message: "formato no válido" } }) });
    expect(r).toEqual({ ok: false, status: 400, motivo: "formato no válido" });
  });

  it("sin red: status 0", async () => {
    const f = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await transcribirNota({ audio: audio(), idioma: "es", modelo: "m", apiKey: "k", fetch: f })).toEqual({ ok: false, status: 0, motivo: "ECONNRESET" });
  });

  it("una respuesta sin texto no se toma por buena", async () => {
    const r = await transcribirNota({ audio: audio(), idioma: "es", modelo: "m", apiKey: "k", fetch: responde(200, { otra: 1 }) });
    expect(r).toEqual({ ok: false, status: 200, motivo: "la respuesta no trae texto" });
  });
});
