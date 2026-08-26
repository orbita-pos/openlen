import { describe, expect, it } from "vitest";

import {
  runtimeCapabilityForPage,
  runtimeMutationCapability,
  runtimeMutationDeniedMessage,
  runtimePolicyEnv,
  type RuntimeMutationCapability,
} from "./runtime-capability";

/**
 * LA TABLA DE CAPACIDAD, y por qué se prueba aquí y no sólo a través de sus
 * consumidores.
 *
 * Esta es la única fuente de «¿puede este turno tocar el JavaScript del
 * modelo?». La consumen el catálogo, el contexto, la ruta del Agente, la
 * herramienta `editar_pagina`, el Chat clásico, el rediseñador y la defensa en
 * profundidad de la persistencia. Hasta hoy vivía sin una sola prueba directa:
 * su conducta se deducía de siete sitios distintos, que es exactamente cómo se
 * llega a que dos de ellos discrepen sin que nadie se entere — el defecto que
 * abrió el hallazgo 1.
 *
 * Lo que estaba roto antes de la política: con `OPENLEN_MODEL_JS=0` el
 * interruptor sólo cambiaba el prompt. La Home seguía ACEPTANDO un
 * `target="runtime"` y persistía una cápsula dormida, que revivía sola el día
 * que alguien encendiera el flag.
 */
describe("runtimeMutationCapability — el interruptor Y la página", () => {
  const ON = { OPENLEN_MODEL_JS: "1" };
  const OFF = { OPENLEN_MODEL_JS: "0" };

  it("ON + Home: permitido", () => {
    expect(runtimeMutationCapability(ON, null)).toEqual({ allowed: true });
  });

  it("ON + subpágina: denegado por subpágina", () => {
    expect(runtimeMutationCapability(ON, "menu")).toEqual({ allowed: false, reason: "subpage" });
  });

  it("OFF + Home: denegado por interruptor — la mitad que faltaba", () => {
    expect(runtimeMutationCapability(OFF, null)).toEqual({ allowed: false, reason: "off" });
  });

  // El motivo NO es cosmético: el boundary le dice al modelo cosas distintas
  // («esto no cabe aquí» vs «esto está apagado»), y una subpágina con el flag
  // encendido no debe sugerir que encender algo lo arreglaría.
  it("OFF + subpágina: manda el interruptor, no la página", () => {
    expect(runtimeMutationCapability(OFF, "menu")).toEqual({ allowed: false, reason: "off" });
  });

  // Opt-IN exacto, al revés que los kill-switches de publicación. Un valor
  // raro no puede encender el piloto por parecerse a un sí.
  it.each(["", "0", "true", "yes", "sí", "01", " 1", "1 ", undefined])(
    "sólo el literal \"1\" enciende (probado: %o)",
    (v) => {
      const env = v === undefined ? {} : { OPENLEN_MODEL_JS: v };
      expect(runtimeMutationCapability(env, null)).toEqual({ allowed: false, reason: "off" });
    },
  );

  // `page === undefined` es el contrato histórico de Home (así llega desde una
  // sesión que nunca cambió de documento). Convertirlo en subpágina apagaría el
  // piloto entero; convertir un slug vacío en Home sería peor.
  it("undefined es Home; una cadena vacía también (los slugs se validan antes)", () => {
    expect(runtimeMutationCapability(ON, undefined)).toEqual({ allowed: true });
    expect(runtimeMutationCapability(ON, "")).toEqual({ allowed: true });
  });
});

/**
 * El modelo puede cambiar de documento a mitad de turno (`trabajar_en_pagina`).
 * Recalcular con esta función en vez de releer el entorno es lo que impide que
 * un turno nacido con el interruptor apagado se encienda solo por moverse a la
 * Home — y esa fue una corrección real durante la revisión: la defensa de
 * persistencia AMPLIABA una denegación de subpágina a permiso cuando el caller
 * decía Home. Una barrera sólo puede restringir lo que recibe.
 */
describe("runtimeCapabilityForPage — al cambiar de documento dentro del turno", () => {
  const OFF: RuntimeMutationCapability = { allowed: false, reason: "off" };
  const SUBPAGE: RuntimeMutationCapability = { allowed: false, reason: "subpage" };
  const ALLOWED: RuntimeMutationCapability = { allowed: true };

  it("un turno APAGADO no se enciende yéndose a la Home", () => {
    expect(runtimeCapabilityForPage(OFF, null)).toEqual({ allowed: false, reason: "off" });
  });

  it("ni moviéndose a otra subpágina", () => {
    expect(runtimeCapabilityForPage(OFF, "menu")).toEqual({ allowed: false, reason: "off" });
  });

  // `subpage` PRUEBA que el flag estaba encendido —si no, sería `off`—, así que
  // volver a la Home sí recupera la autoridad. Es la mitad que hace usable el
  // piloto: entrar a /menu y volver no puede dejar la Home muda el resto del turno.
  it("una denegación por subpágina SÍ se recupera al volver a la Home", () => {
    expect(runtimeCapabilityForPage(SUBPAGE, null)).toEqual({ allowed: true });
  });

  it("y un turno permitido se restringe al entrar en una subpágina", () => {
    expect(runtimeCapabilityForPage(ALLOWED, "menu")).toEqual({ allowed: false, reason: "subpage" });
  });
});

describe("runtimePolicyEnv — la vista para los builders heredados", () => {
  // Varios builders de prompt siguen leyendo `OPENLEN_MODEL_JS` directamente.
  // En vez de darles la capacidad (y tener que tocarlos todos), se les da un
  // entorno que ya refleja la decisión: una denegación es indistinguible de un
  // interruptor apagado, que es justo la variante de prompt que queremos.
  it("una denegación fuerza la variante OFF, venga del flag o de la página", () => {
    const env = { OPENLEN_MODEL_JS: "1", OTRA: "x" };
    for (const cap of [
      { allowed: false, reason: "subpage" } as const,
      { allowed: false, reason: "off" } as const,
    ]) {
      expect(runtimePolicyEnv(env, cap)).toEqual({ OPENLEN_MODEL_JS: "0", OTRA: "x" });
    }
  });

  it("y permitido devuelve el entorno tal cual, sin inventar variables", () => {
    const env = { OPENLEN_MODEL_JS: "1", OTRA: "x" };
    expect(runtimePolicyEnv(env, { allowed: true })).toEqual(env);
  });

  // CONTRA-PRUEBA: no puede mutar el entorno del proceso. Un builder que reciba
  // esta vista no debe poder apagarle el piloto al turno de al lado.
  it("no toca el objeto que recibe", () => {
    const env = { OPENLEN_MODEL_JS: "1" };
    runtimePolicyEnv(env, { allowed: false, reason: "off" });
    expect(env.OPENLEN_MODEL_JS).toBe("1");
  });
});

describe("runtimeMutationDeniedMessage — decir cuál de los dos noes es", () => {
  it("una subpágina dice que la Home es el sitio, y nombra dónde está", () => {
    const m = runtimeMutationDeniedMessage({ allowed: false, reason: "subpage" }, "menu");
    expect(m).toMatch(/HOME/);
    expect(m).toContain('"menu"');
  });

  it("el interruptor apagado no menciona la página, porque no es el motivo", () => {
    const m = runtimeMutationDeniedMessage({ allowed: false, reason: "off" }, "menu");
    expect(m).not.toContain("menu");
    expect(m).toMatch(/apagado/);
  });
});
