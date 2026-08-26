import { describe, expect, it } from "vitest";

import {
  runtimeMutationCapability,
  runtimeMutationDeniedMessage,
  runtimePolicyEnv,
} from "./runtime-capability";

/**
 * LA TABLA DE CAPACIDAD, y por qué encogió.
 *
 * Hasta el 2026-08-25 esto tenía dos motivos de rechazo: el interruptor
 * apagado, y estar en una subpágina. El segundo se retiró **con toda su rama**
 * porque no era una regla de producto: era una limitación de almacenamiento
 * disfrazada de política. La cápsula ata el código a UN documento y sólo había
 * UNA columna, así que sólo la Home podía llevar JavaScript.
 *
 * Ahora cada página guarda la suya (`projects.pageRuntimes`), y lo único que
 * puede decir que no es el interruptor.
 *
 * Las pruebas de la subpágina NO se debilitaron: se RETIRARON, porque fijaban
 * una verdad que expiró. Lo que las sustituye vive en
 * `lib/projects/page-runtimes.test.ts` — que cada página guarde la suya y que
 * ninguna pise a otra.
 *
 * Este módulo sigue siendo la ÚNICA fuente del interruptor: que cada capa lo
 * leyera por su cuenta fue el defecto del hallazgo 1.
 */
describe("runtimeMutationCapability — sólo el interruptor", () => {
  it("encendido: permitido", () => {
    expect(runtimeMutationCapability({ OPENLEN_MODEL_JS: "1" })).toEqual({ allowed: true });
  });

  it("apagado: denegado", () => {
    expect(runtimeMutationCapability({ OPENLEN_MODEL_JS: "0" })).toEqual({
      allowed: false,
      reason: "off",
    });
  });

  // Opt-IN exacto, al revés que los kill-switches de publicación. Un valor raro
  // no puede encender el piloto por parecerse a un sí.
  it.each(["", "0", "true", "yes", "sí", "01", " 1", "1 ", undefined])(
    "sólo el literal \"1\" enciende (probado: %o)",
    (v) => {
      const env = v === undefined ? {} : { OPENLEN_MODEL_JS: v };
      expect(runtimeMutationCapability(env)).toEqual({ allowed: false, reason: "off" });
    },
  );

  // EL CAMBIO DEL 25/08, sujeto: la página ya no entra en la decisión. Si
  // alguien vuelve a colar una firma de dos argumentos, esto no lo caza —
  // TypeScript sí—, pero lo que sí caza es que el resultado dependa de ella.
  it("no hay ninguna página que pueda cambiar la respuesta", () => {
    const on = runtimeMutationCapability({ OPENLEN_MODEL_JS: "1" });
    expect(on.allowed).toBe(true);
    // La firma tiene UN argumento. Pasarle más no puede alterar nada.
    const conBasura = (runtimeMutationCapability as (e: unknown, p?: unknown) => unknown)(
      { OPENLEN_MODEL_JS: "1" },
      "precios",
    );
    expect(conBasura).toEqual({ allowed: true });
  });
});

describe("runtimePolicyEnv — la vista para los builders heredados", () => {
  // Varios builders de prompt siguen leyendo `OPENLEN_MODEL_JS` directamente.
  // En vez de tocarlos todos, se les da un entorno que ya refleja la decisión.
  it("una denegación fuerza la variante OFF", () => {
    const env = { OPENLEN_MODEL_JS: "1", OTRA: "x" };
    expect(runtimePolicyEnv(env, { allowed: false, reason: "off" })).toEqual({
      OPENLEN_MODEL_JS: "0",
      OTRA: "x",
    });
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

describe("runtimeMutationDeniedMessage", () => {
  it("dice el único motivo que queda, y no menciona ninguna página", () => {
    const m = runtimeMutationDeniedMessage();
    expect(m).toMatch(/apagado/);
    expect(m).not.toMatch(/HOME|subpágina|página activa/i);
  });
});
