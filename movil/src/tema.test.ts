import { beforeEach, describe, expect, it } from "vitest";
import { aplicarTema, temaGuardado } from "./tema";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("el tema de la app", () => {
  it("sin nada guardado, naranja (claro), aunque el teléfono esté en oscuro", () => {
    expect(temaGuardado()).toBe("light");
  });

  it("el oscuro elegido a mano se pinta y se recuerda", () => {
    aplicarTema("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(temaGuardado()).toBe("dark");
    aplicarTema("light");
    expect(temaGuardado()).toBe("light");
  });
});
