import { describe, expect, it } from "vitest";

import { etiquetaDeIdioma } from "@/components/marketing/use-dictado";

// El motor de voz reconoce mejor con región: el acento y el vocabulario cambian
// el resultado. Pero sólo entiende regiones de PAÍS.
describe("etiquetaDeIdioma", () => {
  it("usa la variante regional del usuario cuando es del mismo idioma", () => {
    expect(etiquetaDeIdioma("es", ["es-MX", "en-US"])).toBe("es-MX");
    expect(etiquetaDeIdioma("pt", ["pt-BR"])).toBe("pt-BR");
  });

  // 🔴 EL CASO QUE CASI ME MUERDE. Chromium declara `es-419` —español de
  // Latinoamérica, un código de macro-región de la ONU— y el motor de voz
  // espera países. Mi primera versión lo aceptaba.
  it("RECHAZA las macro-regiones: es-419 no es un país", () => {
    expect(etiquetaDeIdioma("es", ["es-419", "en-US"])).toBe("es");
  });

  it("prefiere el país aunque la macro-región venga primero", () => {
    expect(etiquetaDeIdioma("es", ["es-419", "es-MX"])).toBe("es-MX");
  });

  it("no cruza de idioma: la variante tiene que ser del mismo", () => {
    expect(etiquetaDeIdioma("es", ["en-US", "fr-FR"])).toBe("es");
  });

  it("sin nada que ofrecer, manda la base y que elija el motor", () => {
    expect(etiquetaDeIdioma("ja", [])).toBe("ja");
    expect(etiquetaDeIdioma("zh", ["zh"])).toBe("zh");
  });

  it("normaliza a minúsculas la base que da la página", () => {
    expect(etiquetaDeIdioma("ES", ["es-MX"])).toBe("es-MX");
  });
});
