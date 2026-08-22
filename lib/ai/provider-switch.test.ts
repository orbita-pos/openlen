import { describe, expect, it } from "vitest";

import { usesDeepSeek, usesDeepSeekForTurn } from "./provider-switch";

describe("el interruptor de proveedor", () => {
  // Opt-out: la ausencia significa DeepSeek. Si esto se invierte, apagar el
  // interruptor deja de ser el rollback y pasa a ser el encendido.
  it("sin variable corre DeepSeek", () => {
    expect(usesDeepSeek("OPENLEN_CHAT_PROVIDER", {})).toBe(true);
  });

  it.each([["gemini"], ["  gemini  "], ["GEMINI"], ["Gemini"]])(
    "%s vuelve a Gemini",
    (value) => {
      expect(usesDeepSeek("OPENLEN_CHAT_PROVIDER", { OPENLEN_CHAT_PROVIDER: value })).toBe(false);
    },
  );

  it("cualquier otro valor NO apaga DeepSeek — sólo el literal lo hace", () => {
    expect(usesDeepSeek("OPENLEN_CHAT_PROVIDER", { OPENLEN_CHAT_PROVIDER: "0" })).toBe(true);
    expect(usesDeepSeek("OPENLEN_CHAT_PROVIDER", { OPENLEN_CHAT_PROVIDER: "deepseek" })).toBe(true);
  });

  it("los tres interruptores son independientes", () => {
    const env = { OPENLEN_CHAT_PROVIDER: "gemini" };
    expect(usesDeepSeek("OPENLEN_CHAT_PROVIDER", env)).toBe(false);
    expect(usesDeepSeek("OPENLEN_AGENT_PROVIDER", env)).toBe(true);
    expect(usesDeepSeek("OPENLEN_GENERATE_PROVIDER", env)).toBe(true);
  });

  // El razonador de Fireworks no tiene ojos: un turno con imagen que el modelo
  // no puede ver es peor que un turno más caro.
  it("con imagen adjunta manda Gemini pase lo que pase", () => {
    expect(usesDeepSeekForTurn("OPENLEN_CHAT_PROVIDER", true, {})).toBe(false);
    expect(usesDeepSeekForTurn("OPENLEN_CHAT_PROVIDER", false, {})).toBe(true);
  });
});
