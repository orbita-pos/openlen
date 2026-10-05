import { describe, expect, it } from "vitest";

import { codeForHttpStatus, codeForInBandError } from "./provider-error-code";

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

describe("el código de un error que llega DENTRO del stream", () => {
  it("con un estado numérico, el de ese estado", () => {
    expect(codeForInBandError({ code: 429, message: "slow down" })).toBe("rate_limit");
    expect(codeForInBandError({ status: 503, message: "x" })).toBe("server");
  });

  it("BRAZO DE CONTROL: con un estado 4xx que no es 429 NO hay código — un 400 nuestro no se reintenta", () => {
    expect(codeForInBandError({ code: 400, message: "invalid request" })).toBeUndefined();
    expect(codeForInBandError({ status: 422, message: "bad schema" })).toBeUndefined();
  });

  it("sin estado, si habla de límite es «rate_limit»; si no, «server» (falló el proveedor a medias)", () => {
    expect(codeForInBandError({ message: "Rate limit exceeded" })).toBe("rate_limit");
    expect(codeForInBandError({ type: "internal_server_error", message: "server overloaded" })).toBe("server");
  });
});
