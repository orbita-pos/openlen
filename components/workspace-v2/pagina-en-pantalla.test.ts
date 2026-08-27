import { describe, expect, it } from "vitest";

import { paginaEnPantalla, yaEsPagina } from "./pagina-en-pantalla";

// Jesús lo describió así el 2026-08-26, mirando su primera generación con el
// JavaScript ya libre: «me estaba creando la página y después borró todo y puso
// improving design y me mandó otro design».
//
// No borraba nada: la medición había encontrado rotura, el servidor reescribía
// la página y el lienzo pintaba ese stream nuevo DESDE EL PRIMER BYTE. Durante
// unos segundos la pantalla enseñaba un documento a medio abrir, que se ve
// exactamente igual que un borrado.
const PREAMBULO = '<!doctype html><html lang="es"><head><meta charset="utf-8">';
const ANTERIOR = "<!doctype html><html><body><h1>Grano Alto</h1></body></html>";

describe("qué página se ve mientras se escribe otra", () => {
  it("un preámbulo sin <body> NO desplaza a la página que ya estaba", () => {
    expect(paginaEnPantalla(PREAMBULO, ANTERIOR)).toBe(ANTERIOR);
  });

  it("el vacío del reinicio tampoco", () => {
    expect(paginaEnPantalla("", ANTERIOR)).toBe(ANTERIOR);
  });

  it("y en cuanto la nueva ES una página, manda ella", () => {
    const nueva = PREAMBULO + "</head><body><h1>Otra</h1>";
    expect(paginaEnPantalla(nueva, ANTERIOR)).toBe(nueva);
  });

  /**
   * Y se la ve ESCRIBIRSE, que es lo bueno de esto. Aguantar la anterior hasta
   * el final sería la otra forma de mentir: el usuario pidió ver cómo se hace
   * su página. La frontera es `<body>`, no «cuando esté completa».
   */
  it("una página a medio escribir SÍ se pinta — no se espera al </html>", () => {
    const aMedias = PREAMBULO + "</head><body><h1>Otra</h1><section>sin cerra";
    expect(paginaEnPantalla(aMedias, ANTERIOR)).toBe(aMedias);
  });

  /**
   * La PRIMERA generación no tiene página anterior. Ahí más vale enseñar el
   * preámbulo que un vacío: es la señal de que algo está pasando, y es lo que
   * el lienzo hacía siempre antes de que esto existiera.
   */
  it("sin página anterior se pinta lo que haya", () => {
    expect(paginaEnPantalla(PREAMBULO, "")).toBe(PREAMBULO);
  });

  it("reconoce el <body> con atributos y con mayúsculas", () => {
    expect(yaEsPagina('<html><BODY class="x">')).toBe(true);
    expect(yaEsPagina("<html><body>")).toBe(true);
    // `<bodyguard>` no es un <body>: sin esta frontera, un preámbulo que
    // mencione la palabra pasaría por página.
    expect(yaEsPagina("<html><bodyguard>")).toBe(false);
  });
});
