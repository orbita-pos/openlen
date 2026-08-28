import { describe, expect, it } from "vitest";

import { EVAL_TAG, identidadDeEval, preferenciaAterrizo } from "./eval-identity";

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
  // La dirección es DE EJEMPLO a propósito: aquí estaba la real del dueño del
  // repo, y este repo es PÚBLICO (AGPL). Nada de la prueba depende de cuál sea
  // — basta con que no lleve la etiqueta.
  it("rechaza una cuenta normal, que es el accidente que importa", () => {
    const r = identidadDeEval("jesus@gmail.com");
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

describe("preferenciaAterrizo — la columna que el oráculo miraba mal", () => {
  const base = { memoriaPrevia: null, memoriaAhora: null, userBrief: null };

  // EL CASO QUE ESTABA ROTO. Los dos casos que cubren la herramienta dicen
  // «siempre», así que el modelo elige el alcance GLOBAL, escribe en
  // users.agentMemory y deja userBrief vacío. El oráculo exigía userBrief y los
  // suspendía por acertar.
  it("acepta el alcance GLOBAL, que es el defecto de la herramienta", () => {
    expect(
      preferenciaAterrizo({ ...base, memoriaAhora: "• háblame de tú" }),
    ).toBe(true);
  });

  it("y sigue aceptando el alcance de esta página", () => {
    expect(preferenciaAterrizo({ ...base, userBrief: "• nada de amarillo" })).toBe(true);
  });

  it("suspende cuando no se guardó en ningún sitio", () => {
    expect(preferenciaAterrizo(base)).toBe(false);
    expect(preferenciaAterrizo({ ...base, userBrief: "   " })).toBe(false);
  });

  // POR QUÉ SE COMPARA CONTRA LA DE ANTES y no contra vacío: la identidad de
  // evaluación puede traer algo escrito de otra corrida, y «no está vacía»
  // habría dado por bueno un turno que no guardó nada.
  it("una memoria que YA tenía cosas y no cambió no cuenta como guardada", () => {
    expect(
      preferenciaAterrizo({
        memoriaPrevia: "• algo de antes",
        memoriaAhora: "• algo de antes",
        userBrief: null,
      }),
    ).toBe(false);
  });

  it("pero si le añaden algo, sí", () => {
    expect(
      preferenciaAterrizo({
        memoriaPrevia: "• algo de antes",
        memoriaAhora: "• algo de antes\n• y lo nuevo",
        userBrief: null,
      }),
    ).toBe(true);
  });
});