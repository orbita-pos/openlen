import { describe, expect, it } from "vitest";

import { EVAL_TAG, identidadDeEval } from "./eval-identity";

describe("identidadDeEval — la puerta de la memoria de usuario", () => {
  it("acepta una dirección con la etiqueta", () => {
    const r = identidadDeEval("jesus+openlen-eval@gmail.com");
    expect(r).toEqual({ ok: true, email: "jesus+openlen-eval@gmail.com" });
  });

  it("y la recorta antes de mirarla", () => {
    expect(identidadDeEval("  jesus+openlen-eval@gmail.com  ")).toMatchObject({ ok: true });
  });

  // LO QUE ESTO EXISTE PARA IMPEDIR. Poner tu propio correo en una variable de
  // entorno es un despiste de un segundo, y el daño —tus preferencias globales
  // pisadas por un fixture— no se ve hasta que el Agente empieza a tratarte
  // según lo que dijo un caso de prueba.
  it("rechaza una cuenta normal, que es el accidente que importa", () => {
    const r = identidadDeEval("bernal.rojas.dev@gmail.com");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // El mensaje tiene que explicar el DAÑO, no sólo la regla: quien lo lee
      // está a punto de cambiar la variable para que pase.
      expect(r.motivo).toMatch(/agentMemory/);
      expect(r.motivo).toContain(EVAL_TAG);
    }
  });

  it("rechaza la variable vacía o ausente", () => {
    for (const v of [undefined, null, "", "   "]) {
      const r = identidadDeEval(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toMatch(/no está puesta/);
    }
  });

  // La etiqueta es de la parte LOCAL. Un dominio que la contenga no convierte
  // una cuenta cualquiera en identidad de evaluación — y sin mirar sólo la
  // izquierda de la arroba, `alguien@openlen-eval.com` colaría.
  it("la etiqueta cuenta sólo antes de la arroba", () => {
    expect(identidadDeEval("alguien@openlen-eval.com").ok).toBe(false);
    expect(identidadDeEval("alguien@mail+openlen-eval.com").ok).toBe(false);
  });

  it("y con varias arrobas manda la última, como en el correo de verdad", () => {
    expect(identidadDeEval('"raro+openlen-eval"@ejemplo.com').ok).toBe(true);
  });
});
