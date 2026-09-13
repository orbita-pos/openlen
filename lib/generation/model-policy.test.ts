import { describe, expect, it } from "vitest";

import { MODEL_POLICY, esfuerzoDisponible, reasoningEffortFor } from "./model-policy";

describe("Fable model policy", () => {
  it("routes each provider role through the one approved Fireworks model", () => {
    expect(MODEL_POLICY.reasoner.modelId).toBe("accounts/fireworks/models/deepseek-v4-flash-0731");
    // ⚰️ Decía `qwen3p7-plus`. Cambió el 2026-09-12: ese modelo llevaba desde el
    // 2026-08-27 devolviendo 404 en producción y nadie se enteró porque los ojos
    // fallan BLANDO. El porqué entero, con la medición, en `model-policy.ts`.
    expect(MODEL_POLICY.visualCritic.modelId).toBe("accounts/fireworks/models/deepseek-v4p1-flash");
  });

  // LA TARIFA VIAJA CON EL MODELO. Esta prueba existe porque la misma decisión
  // llegó a estar escrita a mano en tres superficies más y las tres se quedaron
  // atrás al cambiar un modelo — la última vez, inflando el gasto 6x.
  it("cada papel cobra la tarifa de su modelo, y el que comparte modelo comparte tarifa", () => {
    expect(MODEL_POLICY.visualCritic.modelId).toBe(MODEL_POLICY.agent.modelId);
    expect(MODEL_POLICY.visualCritic.creditRate).toBe(MODEL_POLICY.agent.creditRate);
  });

  it.each([
    ["reasoner", "copy", "none"],
    ["reasoner", "simple_extraction", "none"],
    ["visual_critic", "candidate_scouting", "none"],
    ["visual_critic", "final_scoring", "none"],
  ] as const)("uses the bounded reasoning policy for %s/%s", (role, operation, expected) => {
    expect(reasoningEffortFor(role, operation)).toBe(expected);
  });

  // Hallazgo 6 (revisión final 2026-09-11): `effort: null` en la fila de
  // `agent_turn` tiene que FALLAR RUIDOSO, no colarse como un valor silencioso
  // — su esfuerzo vive en la capa de POSTURA, no en esta tabla.
  it("agent_turn no tiene esfuerzo en la política — falla ruidoso, no en silencio", () => {
    expect(() => reasoningEffortFor("agent", "agent_turn")).toThrow();
  });
});

describe("el interruptor de pensamiento está SEPARADO del mando", () => {
  it("el papel `agent` declara si piensa, y hoy piensa", () => {
    expect(MODEL_POLICY.agent.piensa).toBe(true);
  });

  it("con el pensamiento encendido, los niveles están disponibles", () => {
    expect(esfuerzoDisponible("high")).toEqual({ ok: true });
    expect(esfuerzoDisponible("auto")).toEqual({ ok: true });
  });

  it("con el pensamiento apagado, el nivel no está disponible y se dice", () => {
    const resultado = esfuerzoDisponible("high", false);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error("inalcanzable: ya se comprobó ok === false");
    expect(resultado.motivo.length).toBeGreaterThan(0);
    expect(resultado.motivo).toContain("high");
  });
});
