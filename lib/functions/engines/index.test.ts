// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { configuredEngineName } from "./index";

describe("configuredEngineName", () => {
  it("vacío, apagado o desconocido → ninguno; local sí, salvo en producción sin permiso", () => {
    expect(configuredEngineName({})).toBeNull();
    expect(configuredEngineName({ OPENLEN_FUNCTIONS_ENGINE: "local" })).toBe("local");
    expect(configuredEngineName({ OPENLEN_FUNCTIONS_ENGINE: "local", OPENLEN_FUNCTIONS: "0" })).toBeNull();
    expect(configuredEngineName({ OPENLEN_FUNCTIONS_ENGINE: "lambda" })).toBeNull();
    expect(configuredEngineName({ OPENLEN_FUNCTIONS_ENGINE: "local", NODE_ENV: "production" })).toBeNull();
    expect(configuredEngineName({ OPENLEN_FUNCTIONS_ENGINE: "local", NODE_ENV: "production", OPENLEN_FUNCTIONS_ALLOW_LOCAL_IN_PRODUCTION: "1" })).toBe("local");
  });
});

it("🔴 un motor por proceso: otra copia del módulo (Next en desarrollo, una por ruta) devuelve el MISMO", async () => {
  const CLAVE = Symbol.for("openlen.functions.engine");
  delete (globalThis as Record<symbol, unknown>)[CLAVE];
  vi.stubEnv("OPENLEN_FUNCTIONS_ENGINE", "local");
  vi.stubEnv("NODE_ENV", "development");
  try {
    const a = (await import("./index")).functionsEngine();
    vi.resetModules();
    const b = (await import("./index")).functionsEngine();
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  } finally {
    vi.unstubAllEnvs();
    delete (globalThis as Record<symbol, unknown>)[CLAVE];
  }
});
