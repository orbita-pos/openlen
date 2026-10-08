import { describe, expect, it } from "vitest";

import { destinoDe, permitido } from "./destino-del-mensaje";

const GENTE = [
  { userId: "u-dana", nombre: "Dana Dueña" },
  { userId: "u-eli", nombre: "Eli Editor" },
  { userId: "u-leo", nombre: "Leo Lector" },
];

describe("a quién va un mensaje del chat", () => {
  it("🔴 sin menciones, o mencionándose a uno mismo, va a Len, como siempre", () => {
    expect(destinoDe("cambia el título", GENTE, "u-dana")).toEqual({ tipo: "len" });
    expect(destinoDe("@Dana Dueña apúntate esto", GENTE, "u-dana")).toEqual({ tipo: "len" });
  });

  it("🔴 una persona sin @Len es un mensaje para ella; con @Len, un turno que también la avisa", () => {
    expect(destinoDe("@Eli Editor mira el pie", GENTE, "u-dana")).toEqual({ tipo: "personas", personas: [GENTE[1]] });
    expect(destinoDe("@Len y @Leo Lector revisad", GENTE, "u-dana")).toEqual({ tipo: "len-y-personas", personas: [GENTE[2]] });
  });

  it("🔴 un lector no puede nada que lleve a Len, ni aunque también mencione a alguien", () => {
    expect(permitido({ tipo: "personas", personas: [GENTE[1]!] }, false)).toBe(true);
    expect(permitido({ tipo: "len" }, false)).toBe(false);
    expect(permitido({ tipo: "len-y-personas", personas: [GENTE[1]!] }, false)).toBe(false);
    expect(permitido({ tipo: "len" }, true)).toBe(true);
  });
});
