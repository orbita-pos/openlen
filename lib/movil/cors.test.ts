// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cabecerasCors, conCors, paraLaApp, respuestaPrevia } from "./cors";

const desde = (origen?: string) => new Request("http://x/api/y", { headers: origen ? { origin: origen } : {} });

describe("CORS sólo para la app", () => {
  it("el origen de la app recibe sus cabeceras", () => {
    const h = cabecerasCors(desde("http://localhost:5173"));
    expect(h["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(h["access-control-allow-headers"]).toBe("authorization, content-type");
    expect(h.vary).toBe("Origin");
    expect(h["access-control-allow-credentials"]).toBeUndefined();
  });

  it("otro origen, o ninguno, no recibe nada", () => {
    expect(cabecerasCors(desde("https://malo.example"))).toEqual({});
    expect(cabecerasCors(desde())).toEqual({});
  });

  it("conCors conserva estado y cuerpo, y deja la respuesta igual si no es la app", async () => {
    const base = new Response("hola", { status: 201, headers: { "content-type": "text/plain" } });
    const r = conCors(desde("https://localhost"), base);
    expect(r.status).toBe(201);
    expect(r.headers.get("content-type")).toBe("text/plain");
    expect(r.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(await r.text()).toBe("hola");
    const otra = new Response("x");
    expect(conCors(desde("https://malo.example"), otra)).toBe(otra);
  });

  it("paraLaApp envuelve el manejador y le pasa el contexto", async () => {
    const h = paraLaApp(async (_req: Request, ctx: { n: number }) => Response.json({ n: ctx.n }));
    const r = await h(desde("capacitor://localhost"), { n: 7 });
    expect(await r.json()).toEqual({ n: 7 });
    expect(r.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
  });

  it("la petición previa (OPTIONS) contesta 204", () => {
    const r = respuestaPrevia(desde("http://localhost:5173"));
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-methods")).toContain("POST");
  });
});
