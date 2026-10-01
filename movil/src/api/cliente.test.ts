import { describe, expect, it, vi } from "vitest";
import { crearClienteDeLaApp } from "./cliente";

const LLAVE = "L".repeat(43);

describe("el cliente de la app", () => {
  it("pide a la base del servidor con la llave en Authorization", async () => {
    const f = vi.fn().mockResolvedValue(new Response("ok"));
    const c = crearClienteDeLaApp({ base: "http://localhost:3007", llave: () => LLAVE, alNoAutorizado: vi.fn(), fetch: f });
    await c.pedir("/api/projects", { method: "GET", headers: { "content-type": "application/json" } });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("http://localhost:3007/api/projects");
    const h = new Headers(init.headers);
    expect(h.get("authorization")).toBe(`Bearer ${LLAVE}`);
    expect(h.get("content-type")).toBe("application/json");
  });

  it("un 401 avisa (la llave ya no vale) y devuelve la respuesta", async () => {
    const alNoAutorizado = vi.fn();
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    const c = crearClienteDeLaApp({ base: "http://b", llave: () => LLAVE, alNoAutorizado, fetch: f });
    expect((await c.pedir("/api/x")).status).toBe(401);
    expect(alNoAutorizado).toHaveBeenCalledOnce();
  });

  it("sin llave no manda Authorization", async () => {
    const f = vi.fn().mockResolvedValue(new Response("ok"));
    const c = crearClienteDeLaApp({ base: "http://b", llave: () => null, alNoAutorizado: vi.fn(), fetch: f });
    await c.pedir("/api/movil/llave", { method: "POST" });
    expect(new Headers(f.mock.calls[0]![1].headers).has("authorization")).toBe(false);
  });

  it("el aviso al cerrar va con keepalive (sendBeacon no lleva cabeceras)", () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const c = crearClienteDeLaApp({ base: "http://b", llave: () => LLAVE, alNoAutorizado: vi.fn(), fetch: f });
    c.avisarAlCerrar("/api/voz/uso", '{"segundos":1}');
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("http://b/api/voz/uso");
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${LLAVE}`);
  });
});
