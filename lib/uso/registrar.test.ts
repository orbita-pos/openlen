import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  values: vi.fn(async (_filas: unknown) => undefined),
}));

vi.mock("@/lib/db", () => ({
  db: { insert: vi.fn(() => ({ values: mocks.values })) },
  schema: { usageEvents: {} },
}));

import { guardarEventos, puedeRegistrar, registrarEnServidor } from "./registrar";

const ctx = (headers: Record<string, string> = {}) => ({ userId: "u1", headers: new Headers(headers) });

describe("registrar eventos de uso en el servidor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("guarda un fallo con el id del usuario y sin sesión de navegador", async () => {
    await registrarEnServidor("crear_fallo", { codigo: "sin_creditos" }, ctx());
    expect(mocks.values).toHaveBeenCalledWith([
      { userId: "u1", name: "crear_fallo", sessionId: null, data: { codigo: "sin_creditos" } },
    ]);
  });

  it("con «No rastrear» o el GPC no guarda nada", async () => {
    await registrarEnServidor("crear_fallo", { codigo: "modelo" }, ctx({ DNT: "1" }));
    await registrarEnServidor("crear_fallo", { codigo: "modelo" }, ctx({ "Sec-GPC": "1" }));
    expect(mocks.values).not.toHaveBeenCalled();
  });

  it("el operador lo apaga con el literal 0, y sólo con ése", () => {
    expect(puedeRegistrar(new Headers(), { OPENLEN_EVENTOS_DE_USO: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(puedeRegistrar(new Headers(), { OPENLEN_EVENTOS_DE_USO: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(puedeRegistrar(new Headers(), {} as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("un código con texto libre no se guarda", async () => {
    await registrarEnServidor("crear_fallo", { codigo: "The model said: hola" }, ctx());
    expect(mocks.values).not.toHaveBeenCalled();
  });

  it("si la base falla no lanza: el turno que lo registra sigue", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.values.mockRejectedValueOnce(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    await expect(
      guardarEventos([{ userId: "u1", nombre: "crear_vista", sesion: "sesion-x1", datos: {} }]),
    ).resolves.toBeUndefined();
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(String(aviso.mock.calls[0][0])).toContain("42P01");
    expect(String(aviso.mock.calls[0][0])).not.toContain("relation does not exist");
    aviso.mockRestore();
  });
});
