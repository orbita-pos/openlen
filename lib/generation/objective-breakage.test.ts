import { describe, expect, it } from "vitest";

import { objectiveBreakage } from "./objective-breakage";

describe("rotura objetiva", () => {
  it("una página sana no da motivos", () => {
    expect(objectiveBreakage({ mobileOverflow: false, invalidGeometry: false, unreadableText: [], typographyHierarchy: null })).toEqual([]);
  });

  // No medir no es prueba de rotura: una página entera no puede caerse porque
  // Chrome no arrancó.
  it("un render que no se pudo hacer no acusa a la página", () => {
    expect(objectiveBreakage(null)).toEqual([]);
    expect(objectiveBreakage(undefined)).toEqual([]);
  });

  it("nombra el desborde y la geometría", () => {
    const reasons = objectiveBreakage({ mobileOverflow: true, invalidGeometry: true });
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toContain("390px");
    expect(reasons[1]).toContain("geometría");
  });

  // Al reparador se le mandaba la palabra "typography" y no tocaba nada: una
  // categoría no dice qué cambiar. Los motivos llevan números.
  it("da los píxeles, no la categoría", () => {
    expect(objectiveBreakage({ typographyHierarchy: { rule: "h1_not_dominant", h1FontPx: 24, heroBodyFontPx: 20 } })[0])
      .toBe("el titular mide 24px y el cuerpo 20px — no se distinguen");
    expect(objectiveBreakage({ typographyHierarchy: { rule: "h1_too_small", h1FontPx: 18, heroBodyFontPx: 16 } })[0])
      .toContain("18px");
  });

  it("dice cuántos textos son ilegibles y cuál es el peor", () => {
    const reasons = objectiveBreakage({ unreadableText: [{ contrast: 1.87 }, { contrast: 1.02 }] });
    expect(reasons[0]).toContain("2 texto(s)");
    expect(reasons[0]).toContain("1.02:1");
  });

  // 🔴 LO QUE SE MIDE TIENE QUE LLEGAR ENTERO A QUIEN LO LEE.
  //
  // Esta frase la ve una PERSONA en la pantalla de generación. La sonda sabe
  // desde siempre qué se sale y hasta dónde, y esta capa lo tiraba en la
  // frontera de tipos: salía «algo se sale de la pantalla», que es justo la
  // categoría que la cabecera de este fichero dice no emitir.
  describe("el desborde dice de qué clase es, no sólo que existe", () => {
    it("una caja demasiado ancha se nombra como caja, con su medida", () => {
      const [motivo] = objectiveBreakage({
        mobileOverflow: true,
        overflowCulprit: "div.bg-surface.border",
        overflowCulpritRight: 585,
        overflowCulpritKind: "caja",
      });
      expect(motivo).toContain("un bloque mide más que la pantalla");
      expect(motivo).toContain("585px");
      // Y NO el selector: a un creador no técnico no le dice nada. La dirección
      // exacta es del modelo y viaja por otro canal.
      expect(motivo).not.toContain("div.bg-surface");
    });

    it("un texto que no parte se nombra como texto, no como caja", () => {
      const [motivo] = objectiveBreakage({
        mobileOverflow: true,
        overflowCulprit: "p#contacto",
        overflowCulpritRight: 579,
        overflowCulpritKind: "tinta",
      });
      expect(motivo).toContain("texto largo sin espacios");
      expect(motivo).toContain("579px");
    });

    it("sin culpable medido, la frase de siempre", () => {
      expect(objectiveBreakage({ mobileOverflow: true })[0]).toContain("algo se sale de la pantalla");
    });
  });

  it("🔴 el texto ilegible se nombra por lo que DICE — es lo que el usuario escribió", () => {
    const [motivo] = objectiveBreakage({
      unreadableText: [
        { contrast: 1.87, texto: "Ver planes" },
        { contrast: 1.0, texto: "Enviar y crear cuenta" },
      ],
    });
    expect(motivo).toContain("«Enviar y crear cuenta»");
    expect(motivo).toContain("1.00:1");
    expect(motivo).toContain("(y 1 más)");
  });

  it("sin texto directo cae a la etiqueta, y sin ninguna de las dos a la frase de siempre", () => {
    expect(objectiveBreakage({ unreadableText: [{ contrast: 1.2, etiqueta: "button" }] })[0])
      .toContain("<button>");
    expect(objectiveBreakage({ unreadableText: [{ contrast: 1.2 }] })[0]).toContain("1 texto(s)");
  });

  it("una regla de tipografía que no conoce no inventa un motivo", () => {
    expect(objectiveBreakage({ typographyHierarchy: { rule: "algo_nuevo", h1FontPx: 40, heroBodyFontPx: 18 } })).toEqual([]);
  });

  // El modo de fallo que NINGUNA captura enseña: el script muere en el arranque
  // y la foto sale perfecta. Medido el 2026-08-21 sobre un juego del modelo.
  it("el error del JavaScript va LITERAL, no como categoría", () => {
    const reasons = objectiveBreakage({
      runtimeErrors: ["TypeError: Assignment to constant variable."],
    });
    expect(reasons).toHaveLength(1);
    // La lección de la tipografía, aplicada al JS: «el script falla» no dice
    // qué arreglar; el mensaje del motor sí.
    expect(reasons[0]).toContain("Assignment to constant variable");
  });

  it("se acota a tres — más suele ser el mismo fallo rebotando", () => {
    const reasons = objectiveBreakage({
      runtimeErrors: ["uno", "dos", "tres", "cuatro", "cinco"],
    });
    expect(reasons).toHaveLength(3);
    expect(reasons.join(" ")).not.toContain("cuatro");
  });

  it("una página sin gritos sigue sin dar motivos", () => {
    expect(objectiveBreakage({ runtimeErrors: [] })).toEqual([]);
    expect(objectiveBreakage({ mobileOverflow: false })).toEqual([]);
  });
});
