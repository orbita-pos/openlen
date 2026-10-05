import { describe, expect, it } from "vitest";

import { codeForHttpStatus } from "./provider-error-code";

describe("el código de un fallo del proveedor (los de DeepSeek)", () => {
  it("429 es límite de peticiones", () => {
    expect(codeForHttpStatus(429)).toBe("rate_limit");
  });

  it("cualquier 5xx es del servidor", () => {
    for (const status of [500, 502, 503, 504, 529]) expect(codeForHttpStatus(status)).toBe("server");
  });

  it("BRAZO DE CONTROL: un 400 o un 401 son defecto nuestro y no se reintentan", () => {
    expect(codeForHttpStatus(400)).toBeUndefined();
    expect(codeForHttpStatus(401)).toBeUndefined();
    expect(codeForHttpStatus(404)).toBeUndefined();
  });
});
