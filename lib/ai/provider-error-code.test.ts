import { describe, expect, it } from "vitest";

import { codeForHttpStatus, codeForInBandError, codeForProviderError } from "./provider-error-code";
import { isRetryable } from "@/lib/agent/retry-policy";

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

describe("el desborde de contexto (el clasificador de DeepSeek, tal cual)", () => {
  it("las frases de los proveedores compatibles con OpenAI son «context_window_exceeded»", () => {
    for (const body of [
      "This model's maximum context length is 1048576 tokens. However, you requested 1100000 tokens",
      "The prompt is too long: 1200005, model maximum context length: 1048576",
      "The prompt exceeds the model's context window",
      '{"error":{"code":"context_length_exceeded","message":"x"}}',
      "Input is too long for this model",
    ]) expect(codeForProviderError(400, body), body).toBe("context_window_exceeded");
    expect(codeForProviderError(413, "request is too large for the model's context window")).toBe("context_window_exceeded");
  });

  it("no se reintenta como un fallo cualquiera (lo arregla la compactación)", () => {
    expect(isRetryable("context_window_exceeded")).toBe(false);
  });

  it("BRAZO DE CONTROL: otro 400 sigue sin código, aunque hable de tokens; un 503 sigue siendo «server»; un 429, límite", () => {
    expect(codeForProviderError(400, "invalid tool schema")).toBeUndefined();
    expect(codeForProviderError(400, "max_tokens: the maximum allowed is 65536 tokens")).toBeUndefined();
    expect(codeForProviderError(503, "")).toBe("server");
    expect(codeForProviderError(429, "context length exceeded")).toBe("rate_limit");
  });

  it("también cuando llega DENTRO del stream", () => {
    expect(codeForInBandError({ code: 400, message: "This model's maximum context length is 1048576 tokens" })).toBe("context_window_exceeded");
    expect(codeForInBandError({ type: "invalid_request_error", message: "The prompt exceeds the model's context window" })).toBe("context_window_exceeded");
    expect(codeForInBandError({ code: "context_length_exceeded", message: "x" })).toBe("context_window_exceeded");
  });
});
