import { describe, expect, it } from "vitest";
import { esfuerzoEfectivo } from "./esfuerzo-efectivo";

describe("la precedencia del esfuerzo", () => {
  it.each([
    [{}, "auto"],
    [{ delUsuario: "medium" as const }, "medium"],
    [{ delUsuario: "medium" as const, delTurno: "xhigh" as const }, "xhigh"],
    [{ delUsuario: "medium" as const, delTurno: "xhigh" as const, env: "low" }, "low"],
    [{ env: "low" }, "low"],
  ])("%o → %s", (entrada, esperado) => {
    expect(esfuerzoEfectivo(entrada)).toBe(esperado);
  });

  it("un valor de entorno inválido se IGNORA en vez de romper el turno", () => {
    expect(esfuerzoEfectivo({ env: "altísimo", delUsuario: "medium" })).toBe("medium");
  });

  it("BRAZO DE CONTROL: `none` no es un nivel — se ignora como cualquier basura", () => {
    expect(esfuerzoEfectivo({ env: "none" })).toBe("auto");
  });
});
