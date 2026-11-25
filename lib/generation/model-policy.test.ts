import { describe, expect, it } from "vitest";

import { writerForTurn } from "../ai/provider-switch";
import {
  MODEL_POLICY,
  capturaRuntimeDelPapel,
  displayNameForRole,
  esfuerzoDisponible,
  modelIdForRole,
  reasoningEffortAllowed,
  reasoningEffortFor,
  roleForOperation,
} from "./model-policy";

// EL JUEZ DE LEN-BENCH, PAPEL PROPIO (spec local 2026-11-12-len-3-1-ruta, §8.5 y §9 fila 7; Jesús, 15/11):
// era la misma 1017 que Len, y sólo por Fireworks. La guía de evals de Anthropic: el juez nunca es el modelo
// que se prueba.
describe("el juez de Len-Bench", () => {
  it("tiene papel propio, servido por DeepInfra", () => {
    expect(roleForOperation("len_bench_juez")).toBe("judge");
    expect(MODEL_POLICY.judge.providers.map((p) => p.provider)).toEqual(["deepinfra"]);
    expect(modelIdForRole("judge")).toBe(MODEL_POLICY.judge.providers[0]!.modelId);
  });
  it("no es de la familia de Len", () => {
    expect(/deepseek/i.test(MODEL_POLICY.judge.modelId)).toBe(false);
    expect(MODEL_POLICY.judge.modelId).not.toBe(MODEL_POLICY.agent.providers[0]!.modelId);
  });
  it("contesta una palabra sin pensar: sólo admite «none»", () => {
    expect(reasoningEffortAllowed("judge", "none")).toBe(true);
    expect(reasoningEffortAllowed("judge", "high")).toBe(false);
    expect(reasoningEffortFor("judge", "len_bench_juez")).toBe("none");
  });
});

describe("Fable model policy", () => {
  it("routes each provider role through the one approved Fireworks model", () => {
    // ⚰️ Era V4 Flash (`deepseek-v4-flash-0731`), que Fireworks sacó de
    // serverless el 2026-09-26: 404 «not deployed». El porqué, en `model-policy.ts`.
    expect(MODEL_POLICY.reasoner.modelId).toBe("accounts/fireworks/models/deepseek-v4p1-flash-1017");
    // ⚰️ Decía `qwen3p7-plus`. Cambió el 2026-09-12: ese modelo llevaba desde el
    // 2026-08-27 devolviendo 404 en producción y nadie se enteró porque los ojos
    // fallan BLANDO. El porqué entero, con la medición, en `model-policy.ts`.
    expect(MODEL_POLICY.visualCritic.modelId).toBe("accounts/fireworks/models/deepseek-v4p1-flash-1017");
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
    // Normalizado como el nombre: un id de DeepInfra conserva mayúsculas y puntos («Qwen3.8-Flash»).
    const tramos = entrada.modelId.split("/").at(-1)!.toLowerCase().replace(/\./g, "p").split("-");
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
  ] as const)("uses the bounded reasoning policy for %s/%s", (role, operation, expected) => {
    expect(reasoningEffortFor(role, operation)).toBe(expected);
  });

  // Hallazgo 6 (revisión final 2026-09-11): `effort: null` en la fila de
  // `agent_turn` tiene que FALLAR RUIDOSO, no colarse como un valor silencioso
  // — su esfuerzo vive en la capa de POSTURA, no en esta tabla.
  it("agent_turn y odyssey_turn no tienen esfuerzo en la política — fallan ruidoso, no en silencio", () => {
    expect(() => reasoningEffortFor("agent", "agent_turn")).toThrow();
    expect(() => reasoningEffortFor("odyssey", "odyssey_turn")).toThrow();
  });
});

describe("el interruptor de pensamiento está SEPARADO del mando", () => {
  it("los papeles `agent` y `odyssey` declaran si piensan y si ven, y hoy ambos piensan y ven", () => {
    expect(MODEL_POLICY.agent.piensa).toBe(true);
    expect(MODEL_POLICY.odyssey.piensa).toBe(true);
    expect(MODEL_POLICY.odyssey.veImagenes).toBe(true);
    expect(roleForOperation("odyssey_turn")).toBe("odyssey");
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
    expect(capturaRuntimeDelPapel("odyssey")).toBe(false);
  });
});
