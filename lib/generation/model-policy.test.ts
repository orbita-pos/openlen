import { describe, expect, it } from "vitest";

import { writerForTurn } from "../ai/provider-switch";
import {
  MODEL_POLICY,
  capturaRuntimeDelPapel,
  displayNameForRole,
  esfuerzoDisponible,
  reasoningEffortFor,
  roleForOperation,
} from "./model-policy";

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

  // EL NOMBRE VISIBLE VIAJA CON EL ID. Lo pinta la entrada de Crear, así que un
  // cambio de modelo sin renombrar le mentiría al usuario en la primera pantalla.
  // Cada palabra del nombre tiene que ser un tramo del id y cada tramo con letras
  // del id tiene que estar en el nombre («V4.1» se escribe `v4p1` en el id; la
  // fecha del final no lleva letras y no cuenta).
  it.each(Object.entries(MODEL_POLICY))("el nombre visible de %s es el de su modelo", (_papel, entrada) => {
    const tramos = entrada.modelId.split("/").at(-1)!.split("-");
    const palabras = entrada.displayName.toLowerCase().replace(/\./g, "p").split(/\s+/);
    for (const palabra of palabras) expect(tramos).toContain(palabra);
    for (const tramo of tramos.filter((t) => /[a-z]/.test(t))) expect(palabras).toContain(tramo);
  });

  it("Crear nombra al que escribe DE VERDAD: con imagen, el papel con visión", () => {
    expect(displayNameForRole(writerForTurn(false))).toBe(MODEL_POLICY.reasoner.displayName);
    expect(displayNameForRole(writerForTurn(true))).toBe(MODEL_POLICY.visualCritic.displayName);
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

  // ─── LA CAPTURA DEL JAVASCRIPT ES UNA CAPACIDAD DECLARADA ──────────────────
  //
  // 🔴 ESTA PUERTA NO LA CUBRÍA NADA, y por eso se pinta aquí. En `ai-design`
  // era `writer === "reasoner"`, justificado con «la cápsula se llama
  // deepseek-generate-v1» — una constante que NO EXISTE en el código. Ninguna
  // prueba de aquella ruta la tocaba, así que moverla no ponía nada rojo: el
  // Chat podría haber dejado de capturar el JavaScript del modelo EN SILENCIO,
  // que es la forma exacta del defecto que este repo persigue.
  //
  // No se afirma «el Chat captura» —eso es de la ruta, y su prueba no existe
  // todavía— sino la DECISIÓN de política que lo permite. Si alguien mueve
  // `page_edit` a un papel que no captura, esto se pone rojo y hay que venir a
  // decidirlo en vez de descubrirlo por una página sin JavaScript.
  it("quien escribe el Chat puede capturar el JavaScript del modelo", () => {
    expect(capturaRuntimeDelPapel(roleForOperation("page_edit"))).toBe(true);
  });

  it("y los tres papeles lo declaran, en vez de deducirse de quién son", () => {
    for (const papel of ["reasoner", "visual_critic", "agent"] as const) {
      expect(typeof capturaRuntimeDelPapel(papel), `${papel} no lo declara`).toBe("boolean");
    }
    // Los tres corren DeepSeek hoy. Un papel que no lo sea entra con `false`
    // explícito, y entonces esta línea es la que hay que venir a cambiar.
    expect(capturaRuntimeDelPapel("reasoner")).toBe(true);
    expect(capturaRuntimeDelPapel("visual_critic")).toBe(true);
  });
});
