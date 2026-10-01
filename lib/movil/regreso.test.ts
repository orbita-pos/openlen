import { describe, expect, it } from "vitest";
import { urlDeRegreso } from "./regreso";

const base = { codigo: "c0d1g0", estado: "estado-de-prueba-0123" };

describe("a dónde vuelve el navegador con el código", () => {
  it("a la app, por su esquema propio", () => {
    expect(urlDeRegreso({ ...base, retorno: "app", produccion: true })).toBe("openlen://entrar?codigo=c0d1g0&estado=estado-de-prueba-0123");
  });

  it("en dev, a Vite en el navegador de la PC", () => {
    expect(urlDeRegreso({ ...base, retorno: "dev", produccion: false })).toBe("http://localhost:5173/?codigo=c0d1g0&estado=estado-de-prueba-0123");
  });

  it("en producción no hay regreso a Vite", () => {
    expect(urlDeRegreso({ ...base, retorno: "dev", produccion: true })).toBeNull();
  });
});
