import { describe, expect, it } from "vitest";

import { COLORES_DE_PERSONA, arrobaEnCurso, colorDePersona, hayMencion, mencionesDe, opcionesDeMencion, ponerMencion, trozosConMenciones } from "./menciones";

const GENTE = [
  { userId: "u-ana", nombre: "Ana López" },
  { userId: "u-luis", nombre: "Luis" },
  { userId: "u-correo", nombre: "jose@example.com" },
];

describe("las menciones de un comentario", () => {
  it("🔴 @Len y @Nombre exactos (sin distinguir mayúsculas), con espacios y correos", () => {
    expect(mencionesDe("@len pon esto en azul", GENTE)).toEqual({ len: true, personas: [] });
    expect(mencionesDe("@Ana López ¿y @luis? Ojo @jose@example.com", GENTE)).toEqual({ len: false, personas: ["u-ana", "u-luis", "u-correo"] });
    // Un correo cualquiera o una palabra que empieza igual NO es una mención.
    expect(mencionesDe("escribe a ana@lopez.com y a @Luisa", GENTE)).toEqual({ len: false, personas: [] });
    expect(mencionesDe("@Lento no es Len", GENTE).len).toBe(false);
    expect(hayMencion(mencionesDe("sin nadie", GENTE))).toBe(false);
  });

  it("el @ que se está escribiendo, sus opciones y ponerlo", () => {
    expect(arrobaEnCurso("hola @an", 8)).toEqual({ desde: 5, busca: "an" });
    expect(arrobaEnCurso("hola@an", 7)).toBeNull();
    expect(arrobaEnCurso("@", 1)).toEqual({ desde: 0, busca: "" });
    expect(opcionesDeMencion("", GENTE, true).map((o) => o.etiqueta)).toEqual(["Len", "Ana López", "Luis", "jose@example.com"]);
    expect(opcionesDeMencion("l", GENTE, false).map((o) => o.etiqueta)).toEqual(["Luis", "Ana López"]);
    expect(ponerMencion("hola @an que tal", 5, 8, "Ana López")).toEqual({ texto: "hola @Ana López  que tal", cursor: 16 });
  });
});

describe("los colores de las menciones", () => {
  it("🔴 el texto en trozos: @Len y cada @persona aparte, lo demás tal cual", () => {
    expect(trozosConMenciones("@Len pon esto y avisa a @ana lópez, gracias", GENTE)).toEqual([
      { texto: "@Len", len: true },
      { texto: " pon esto y avisa a " },
      { texto: "@ana lópez", userId: "u-ana" },
      { texto: ", gracias" },
    ]);
    // Los mismos límites que `mencionesDe`: un correo o un nombre más largo no cuentan.
    expect(trozosConMenciones("escribe a ana@lopez.com y a @Luisa o @Lento", GENTE)).toEqual([
      { texto: "escribe a ana@lopez.com y a @Luisa o @Lento" },
    ]);
    // Un nombre que contiene a otro: gana el más largo.
    expect(trozosConMenciones("@Luis Mi y @Luis", [...GENTE, { userId: "u-lm", nombre: "Luis Mi" }])).toEqual([
      { texto: "@Luis Mi", userId: "u-lm" },
      { texto: " y " },
      { texto: "@Luis", userId: "u-luis" },
    ]);
    expect(trozosConMenciones("", GENTE)).toEqual([]);
  });

  it("🔴 cada persona del proyecto, un color distinto y el mismo en todas partes", () => {
    const ids = GENTE.map((p) => p.userId);
    const colores = ids.map((id) => colorDePersona(id, ids));
    expect(new Set(colores).size).toBe(ids.length);
    expect(colorDePersona("u-luis", ids)).toBe(colorDePersona("u-luis", ids));
    // Quien no está en la lista (ya no es miembro) también tiene color, siempre el mismo.
    expect(COLORES_DE_PERSONA).toContain(colorDePersona("u-se-fue", ids));
    expect(colorDePersona("u-se-fue", ids)).toBe(colorDePersona("u-se-fue", []));
    // Ninguno es el naranja de Len.
    expect(COLORES_DE_PERSONA.every((c) => !c.includes("accent"))).toBe(true);
  });
});
