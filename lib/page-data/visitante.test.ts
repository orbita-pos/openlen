import { describe, expect, it } from "vitest";
import {
  cabeceraDeVisitante,
  nuevoVisitante,
  verificaVisitante,
} from "./visitante";

const SECRETO = "secreto-de-prueba-suficientemente-largo";

describe("la cookie del visitante", () => {
  it("ida y vuelta devuelve el mismo id", () => {
    const cookie = nuevoVisitante(SECRETO);
    const id = verificaVisitante(cookie, SECRETO);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("dos visitantes distintos no colisionan", () => {
    expect(nuevoVisitante(SECRETO)).not.toBe(nuevoVisitante(SECRETO));
  });

  // Sin esto, cualquiera se inventa el id de otro y le lee el carrito.
  it("rechaza una firma manipulada", () => {
    const cookie = nuevoVisitante(SECRETO);
    const [id] = cookie.split(".");
    expect(verificaVisitante(`${id}.firmafalsa`, SECRETO)).toBeNull();
  });

  it("rechaza un id manipulado con firma buena de otro", () => {
    const [, firma] = nuevoVisitante(SECRETO).split(".");
    expect(
      verificaVisitante(`00000000000000000000000000000000.${firma}`, SECRETO),
    ).toBeNull();
  });

  it("rechaza otra clave", () => {
    const cookie = nuevoVisitante(SECRETO);
    expect(verificaVisitante(cookie, "otra-clave-distinta-y-larga")).toBeNull();
  });

  it("sin cookie devuelve null, no lanza", () => {
    expect(verificaVisitante(undefined, SECRETO)).toBeNull();
    expect(verificaVisitante("", SECRETO)).toBeNull();
    expect(verificaVisitante("basura", SECRETO)).toBeNull();
  });
});

// 🔴 SIN `Domain`, y es lo único que importa de esta cabecera.
//
// Medido en Chrome el 2026-09-18: con `Domain=<sub>.openlen.app`, una página
// servida en un dominio propio (www.cafe.mx) recibe la cookie y el navegador
// la TIRA con motivo `InvalidDomain` — el dominio no cubre al host. Cada
// petición estrena visitante, así que el carrito no lee nada y cada guardado
// abre una fila nueva. Host-only funciona en los dos sitios.
describe("la cabecera de la cookie del visitante", () => {
  const cabecera = cabeceraDeVisitante("abc.firma");

  it("🔴 no lleva Domain", () => {
    expect(cabecera).not.toContain("Domain=");
  });

  it("conserva los demás atributos", () => {
    expect(cabecera).toContain("ol_v=abc.firma");
    expect(cabecera).toContain("Path=/");
    expect(cabecera).toContain("Max-Age=63072000");
    expect(cabecera).toContain("HttpOnly");
    expect(cabecera).toContain("Secure");
    expect(cabecera).toContain("SameSite=Lax");
  });
});
