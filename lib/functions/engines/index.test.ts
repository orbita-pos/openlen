// @vitest-environment node
import { describe, expect, it } from "vitest";

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
