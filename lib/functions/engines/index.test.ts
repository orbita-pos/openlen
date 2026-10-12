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

  it("cloudflare: con sus cinco variables, sí (también en producción); si falta una, apagado", () => {
    const CF = {
      OPENLEN_FUNCTIONS_ENGINE: "cloudflare",
      OPENLEN_CF_ACCOUNT_ID: "a",
      OPENLEN_CF_API_TOKEN: "t",
      OPENLEN_CF_NAMESPACE: "n",
      OPENLEN_CF_DISPATCH_URL: "https://d",
      OPENLEN_CF_DISPATCH_KEY: "k",
    };
    expect(configuredEngineName(CF)).toBe("cloudflare");
    expect(configuredEngineName({ ...CF, NODE_ENV: "production" })).toBe("cloudflare");
    expect(configuredEngineName({ ...CF, OPENLEN_CF_DISPATCH_KEY: " " })).toBeNull();
    expect(configuredEngineName({ ...CF, OPENLEN_FUNCTIONS: "0" })).toBeNull();
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

it("🔴 con cloudflare configurado, el motor del proceso es el de Cloudflare", async () => {
  const CLAVE = Symbol.for("openlen.functions.engine");
  delete (globalThis as Record<symbol, unknown>)[CLAVE];
  const vars = { OPENLEN_FUNCTIONS_ENGINE: "cloudflare", OPENLEN_CF_ACCOUNT_ID: "a", OPENLEN_CF_API_TOKEN: "t", OPENLEN_CF_NAMESPACE: "n", OPENLEN_CF_DISPATCH_URL: "https://d", OPENLEN_CF_DISPATCH_KEY: "k" };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  try {
    vi.resetModules();
    const e = (await import("./index")).functionsEngine();
    expect(e?.name).toBe("cloudflare");
  } finally {
    vi.unstubAllEnvs();
    delete (globalThis as Record<symbol, unknown>)[CLAVE];
  }
});
