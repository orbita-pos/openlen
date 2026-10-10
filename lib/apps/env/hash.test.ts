// @vitest-environment node
// Las huellas de las variables (lib/apps/env/hash.ts).
import { describe, expect, it } from "vitest";
import { envHashOf, envVersionOf, varsOfTarget } from "./hash";

describe("envHashOf — lo que compara «cambios sin publicar»", () => {
  it("sin variables, sin huella", () => expect(envHashOf({})).toBeNull());
  it("cambia con un nombre o un valor; no con el orden", () => {
    const a = envHashOf({ VITE_A: "1", VITE_B: "2" });
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(envHashOf({ VITE_B: "2", VITE_A: "1" })).toBe(a);
    expect(envHashOf({ VITE_A: "1", VITE_B: "3" })).not.toBe(a);
    expect(envHashOf({ VITE_A: "1", VITE_C: "2" })).not.toBe(a);
  });
});

describe("envVersionOf — la del «cambió mientras tanto»", () => {
  const l = [
    { name: "VITE_A", target: "draft" as const, value: "1" },
    { name: "VITE_A", target: "production" as const, value: "2" },
  ];
  it("la lista entera, sin importar el orden; vacía también tiene versión", () => {
    expect(envVersionOf(l)).toBe(envVersionOf([...l].reverse()));
    expect(envVersionOf([l[0]!])).not.toBe(envVersionOf(l));
    expect(envVersionOf([])).toMatch(/^[0-9a-f]{16}$/);
  });
  it("varsOfTarget: las de un entorno, como las lee import.meta.env", () => {
    expect(varsOfTarget(l, "production")).toEqual({ VITE_A: "2" });
  });
});
