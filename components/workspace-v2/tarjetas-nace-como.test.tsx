// What choosing App adds to the first message. The cards these tests used to drive went on 06/11 (the choice is the
// composer's pill now: components/marketing/hero-kind-picker.test.tsx and hero-prompt-input.test.tsx).
import { describe, expect, it } from "vitest";

describe("lo que elegir App añade al primer mensaje", () => {
  it("una página no añade nada; una app, `naceComo` y el idioma", async () => {
    const { camposDeNacer } = await import("./chat/nace-como");
    expect(camposDeNacer(null)).toEqual({});
    expect(camposDeNacer({ idioma: "es" })).toEqual({});
    expect(camposDeNacer({ naceComo: "app", idioma: "ja" })).toEqual({ naceComo: "app", idioma: "ja" });
    expect(camposDeNacer({ naceComo: "app" })).toEqual({ naceComo: "app" });
  });
});
