import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  guardarEventos: vi.fn(async (_filas: unknown) => undefined),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: {}, schema: {} }));
vi.mock("@/lib/uso/registrar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/uso/registrar")>()),
  guardarEventos: mocks.guardarEventos,
}));

import { POST } from "./route";

const SESION = "0f8e2c1a-6b1d-4d7e-9a55-3c2b1f0e9d11";
const vista = { nombre: "crear_vista", sesion: SESION, datos: {} };

function pedir(cuerpo: unknown, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
  return POST(
    new Request("http://localhost/api/uso", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    }),
  );
}

function guardado(): { userId: string; nombre: string }[] {
  return (mocks.guardarEventos.mock.calls.at(-1)?.[0] ?? []) as { userId: string; nombre: string }[];
}

describe("POST /api/uso", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  });

  it("guarda con el usuario de la SESIÓN aunque el cuerpo diga otro", async () => {
    const res = await pedir({ eventos: [{ ...vista, userId: "otro" }], userId: "otro" });
    expect(res.status).toBe(204);
    expect(guardado()).toEqual([{ userId: "u1", nombre: "crear_vista", sesion: SESION, datos: {} }]);
  });

  it("sin sesión contesta 204 y no guarda", async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await pedir({ eventos: [vista] });
    expect(res.status).toBe(204);
    expect(mocks.guardarEventos).not.toHaveBeenCalled();
  });

  it("descarta un fallo fingido desde el navegador y guarda el resto del lote", async () => {
    await pedir({
      eventos: [vista, { nombre: "crear_fallo", sesion: SESION, datos: { codigo: "modelo" } }],
    });
    expect(guardado().map((f) => f.nombre)).toEqual(["crear_vista"]);
  });

  it("no pasa del tope por petición", async () => {
    await pedir({ eventos: Array.from({ length: 50 }, () => vista) });
    expect(guardado()).toHaveLength(20);
  });

  it("con «No rastrear» no guarda nada", async () => {
    await pedir({ eventos: [vista] }, { "sec-fetch-site": "same-origin", DNT: "1" });
    expect(mocks.guardarEventos).not.toHaveBeenCalled();
  });

  it("desde otro origen —una página publicada, por ejemplo— no guarda nada", async () => {
    await pedir({ eventos: [vista] }, { "sec-fetch-site": "same-site" });
    await pedir({ eventos: [vista] }, { "sec-fetch-site": "cross-site" });
    expect(mocks.guardarEventos).not.toHaveBeenCalled();
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("un cuerpo roto contesta 204 sin romperse", async () => {
    const res = await pedir("{no es json");
    expect(res.status).toBe(204);
    expect(mocks.guardarEventos).not.toHaveBeenCalled();
  });
});
