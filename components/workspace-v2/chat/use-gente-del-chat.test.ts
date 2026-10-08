import { describe, expect, it } from "vitest";

import { genteDesdeMiembros } from "./use-gente-del-chat";

describe("la gente del chat", () => {
  it("🔴 el dueño primero y luego los miembros (el orden de los colores); sin miembros, no es compartido", () => {
    const r = genteDesdeMiembros({
      rol: "lector",
      yo: "u-leo",
      dueno: { userId: "u-dana", name: "Dana Dueña", email: "d@x" },
      miembros: [
        { userId: "u-eli", name: null, email: "eli@x" },
        { userId: "u-leo", name: "Leo Lector", email: "l@x" },
      ],
    });
    expect(r.gente).toEqual([
      { userId: "u-dana", nombre: "Dana Dueña" },
      { userId: "u-eli", nombre: "eli@x" },
      { userId: "u-leo", nombre: "Leo Lector" },
    ]);
    expect(r).toMatchObject({ yo: "u-leo", puedeLen: false, compartido: true });
    expect(genteDesdeMiembros({ rol: "dueno", yo: "u-dana", dueno: { userId: "u-dana", name: "Dana", email: "d@x" }, miembros: [] }).compartido).toBe(false);
  });

  it("🔴 con invitaciones sin aceptar, el dueño está esperando a alguien", () => {
    const dueno = { userId: "u-dana", name: "Dana", email: "d@x" };
    expect(genteDesdeMiembros({ rol: "dueno", yo: "u-dana", dueno, miembros: [], invitaciones: [{ email: "eli@x" }] }).esperando).toBe(true);
    expect(genteDesdeMiembros({ rol: "dueno", yo: "u-dana", dueno, miembros: [], invitaciones: [] }).esperando).toBe(false);
    // A un miembro no le llegan las invitaciones: no espera a nadie.
    expect(genteDesdeMiembros({ rol: "editor", yo: "u-eli", dueno, miembros: [] }).esperando).toBe(false);
  });
});
