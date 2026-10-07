import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  values: vi.fn(async (_filas: unknown) => undefined),
}));

vi.mock("@/lib/db", () => ({
  db: { insert: vi.fn(() => ({ values: mocks.values })) },
  schema: { usageEvents: {} },
}));

import { guardarEventos, puedeRegistrar } from "./registrar";

describe("registrar eventos de uso en el servidor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ⚰️ Las pruebas de `registrarEnServidor` (guardar `crear_fallo`, y no
  // guardarlo con «No rastrear», el GPC o un código con texto libre) se fueron
  // con él el 2026-10-06. «No rastrear» y el GPC siguen probados aquí abajo,
  // por `puedeRegistrar`, que es quien los decide.
  it("con «No rastrear» o el GPC no se registra", () => {
    expect(puedeRegistrar(new Headers({ DNT: "1" }), {} as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(puedeRegistrar(new Headers({ "Sec-GPC": "1" }), {} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("el operador lo apaga con el literal 0, y sólo con ése", () => {
    expect(puedeRegistrar(new Headers(), { OPENLEN_EVENTOS_DE_USO: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(puedeRegistrar(new Headers(), { OPENLEN_EVENTOS_DE_USO: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(puedeRegistrar(new Headers(), {} as unknown as NodeJS.ProcessEnv)).toBe(true);
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
