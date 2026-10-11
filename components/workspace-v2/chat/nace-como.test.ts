// La portada pide nacer como app por la URL: `/new?brief=…&kind=app`.
import { describe, expect, it } from "vitest";
import { kindFromParam, newProjectHref } from "./nace-como";

describe("el tipo que trae la URL de /new", () => {
  it("sólo `app` es app; lo demás, o nada, es página", () => {
    expect(kindFromParam("app")).toBe("app");
    expect(kindFromParam(null)).toBe("pagina");
    expect(kindFromParam("")).toBe("pagina");
    expect(kindFromParam("pagina")).toBe("pagina");
    expect(kindFromParam("APP ")).toBe("pagina");
  });
});

describe("el enlace de la portada a /new", () => {
  it("una página va sólo con el brief, como siempre", () => {
    expect(newProjectHref("hola mundo", "pagina")).toBe("/new?brief=hola%20mundo");
  });
  it("🔴 una app lleva además `kind=app`", () => {
    expect(newProjectHref("un punto de venta", "app")).toBe("/new?brief=un%20punto%20de%20venta&kind=app");
  });
  it("y el brief va recortado de espacios y escapado", () => {
    expect(newProjectHref("  a&b=c  ", "app")).toBe("/new?brief=a%26b%3Dc&kind=app");
  });
});
