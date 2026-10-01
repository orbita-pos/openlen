// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ canjear: vi.fn(), borrar: vi.fn() }));
vi.mock("@/lib/movil/llaves", () => ({ canjearCodigo: mocks.canjear, borrarLlave: mocks.borrar }));

import { DELETE, OPTIONS, POST } from "./route";

const ESTADO = "estado-de-prueba-0123456789";
const LLAVE = "L".repeat(43);
const post = (body: unknown) =>
  new Request("http://x/api/movil/llave", { method: "POST", headers: { origin: "http://localhost:5173" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canjear.mockResolvedValue({ llave: LLAVE, userId: "u1" });
});

describe("/api/movil/llave", () => {
  it("canjea el código por la llave, con CORS para la app", async () => {
    const r = await POST(post({ codigo: "c".repeat(43), estado: ESTADO, nombre: "Pixel" }), undefined);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ llave: LLAVE });
    expect(mocks.canjear).toHaveBeenCalledWith("c".repeat(43), ESTADO, "Pixel");
    expect(r.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("un código que no vale → 401", async () => {
    mocks.canjear.mockResolvedValue(null);
    const r = await POST(post({ codigo: "c".repeat(43), estado: ESTADO }), undefined);
    expect(r.status).toBe(401);
  });

  it("datos mal formados → 400 sin tocar la base", async () => {
    const r = await POST(post({ codigo: 5, estado: "corto" }), undefined);
    expect(r.status).toBe(400);
    expect(mocks.canjear).not.toHaveBeenCalled();
  });

  it("salir borra la llave de la cabecera", async () => {
    const r = await DELETE(new Request("http://x/api/movil/llave", { method: "DELETE", headers: { authorization: `Bearer ${LLAVE}` } }), undefined);
    expect(r.status).toBe(204);
    expect(mocks.borrar).toHaveBeenCalledWith(LLAVE);
  });

  it("salir sin llave → 401", async () => {
    const r = await DELETE(new Request("http://x/api/movil/llave", { method: "DELETE" }), undefined);
    expect(r.status).toBe(401);
  });

  it("OPTIONS contesta la petición previa", () => {
    expect(OPTIONS(new Request("http://x", { headers: { origin: "https://localhost" } })).status).toBe(204);
  });
});
