import { describe, it, expect } from "vitest";
import { classifyAiError } from "./ai-error-message";

describe("classifyAiError", () => {
  it("clasifica el 503 real de Gemini que vio el usuario", () => {
    expect(
      classifyAiError(
        'upstream API returned HTTP 503: { "error": { "code": 503, "message": "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.", "status": "UNAVAILABLE" } }',
      ),
    ).toBe("saturated");
  });

  it("clasifica la llave prepago agotada como cuota", () => {
    expect(classifyAiError("upstream API returned HTTP 429: RESOURCE_EXHAUSTED")).toBe("quota");
    expect(classifyAiError("You exceeded your current quota")).toBe("quota");
  });

  it("clasifica el corte por tiempo", () => {
    expect(classifyAiError("request timed out after 120s")).toBe("timeout");
    expect(classifyAiError("ETIMEDOUT")).toBe("timeout");
  });

  it("cae en unknown sin mensaje o con algo que no reconoce", () => {
    expect(classifyAiError(undefined)).toBe("unknown");
    expect(classifyAiError(null)).toBe("unknown");
    expect(classifyAiError("")).toBe("unknown");
    expect(classifyAiError("algo rarísimo que nadie previó")).toBe("unknown");
  });

  it("el 503 gana sobre menciones sueltas de rate limit en el mismo cuerpo", () => {
    // Gemini a veces menciona límites dentro de un 503; la acción del usuario
    // es la misma (esperar) pero el mensaje de saturación es el honesto.
    expect(classifyAiError("HTTP 503 UNAVAILABLE — rate limit info attached")).toBe("saturated");
  });
});
