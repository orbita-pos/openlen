import { describe, expect, it, vi } from "vitest";
import { abrirSesionDeVoz, cuerpoDeSesion, URL_DE_SESIONES } from "./sesion";
import { MODELO_DE_VOZ, vozParaIdioma } from "./voces";

const config = vozParaIdioma("es");

describe("cuerpoDeSesion", () => {
  it("delegación al cliente, voz e instrucciones del idioma, y la oferta SDP", () => {
    expect(cuerpoDeSesion({ sdp: "v=0 oferta", config })).toEqual({
      session: {
        model: MODELO_DE_VOZ,
        instructions: config.instrucciones,
        audio: { output: { voice: "marin" } },
        delegation: { type: "client" },
      },
      transport: { type: "webrtc", sdp: "v=0 oferta" },
    });
  });
});

describe("abrirSesionDeVoz", () => {
  it("manda la clave sólo en la cabecera y devuelve la respuesta SDP y el id", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ session: { id: "live_1" }, transport: { type: "webrtc", sdp: "v=0 respuesta" } }), { status: 201 }),
    );
    const r = await abrirSesionDeVoz({ sdp: "v=0 oferta", config, apiKey: "sk-test", fetch: f });
    expect(r).toEqual({ ok: true, sdp: "v=0 respuesta", sesionId: "live_1" });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(URL_DE_SESIONES);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer sk-test");
    expect(String(init.body)).not.toContain("sk-test");
  });

  it("un error de OpenAI vuelve con su estado y su mensaje, no revienta", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Offer did not have an audio media section." } }), { status: 400 }),
    );
    expect(await abrirSesionDeVoz({ sdp: "x", config, apiKey: "k", fetch: f })).toEqual({
      ok: false,
      status: 400,
      motivo: "Offer did not have an audio media section.",
    });
  });

  it("una respuesta 2xx sin SDP es un fallo, no una sesión", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    const r = await abrirSesionDeVoz({ sdp: "x", config, apiKey: "k", fetch: f });
    expect(r.ok).toBe(false);
  });

  it("si la red falla, vuelve como fallo con estado 0", async () => {
    const f = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    expect(await abrirSesionDeVoz({ sdp: "x", config, apiKey: "k", fetch: f })).toEqual({ ok: false, status: 0, motivo: "ECONNRESET" });
  });
});
