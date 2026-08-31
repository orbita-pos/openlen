// DOS TAMAÑOS DE ICONO EN EL CROMO, y esta prueba es lo que impide que vuelvan
// a ser seis.
//
// MEDIDO el 2026-08-31, antes de arreglarlo: el taller usaba 10, 11, 12, 13 y
// 14 — cinco de ellos sólo en `top-bar.tsx`. Cada icono estaba bien dibujado
// (los 75 de `icons.tsx` comparten `viewBox 24` y `strokeWidth 2`, la misma
// rejilla que Lucide, y por eso mezclarlos con `lucide-react` no desentona),
// pero la fila se leía desordenada porque ninguno medía lo mismo que su vecino.
//
// LO QUE ESTA PRUEBA NO VIGILA, a propósito: los glifos pegados a un texto de
// 10-11px — la barra de estado, los avisos sobre el lienzo, las filas de un
// desplegable. Ahí el tamaño lo manda la tipografía. Vigilar eso obligaría a
// subirlos a 12 y gritarían al lado de su propia etiqueta.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "components/workspace-v2");
const leer = (f: string) => readFileSync(join(DIR, f), "utf8");

/** Los ficheros que pintan la FILA de una barra o el rail. */
const CROMO = [
  "preview-area.tsx",
  "left-sidebar.tsx",
  "address-bar.tsx",
  "ui.tsx",
] as const;

describe("los tamaños de icono del cromo", () => {
  it("están declarados UNA vez, no repartidos por los ficheros", () => {
    const iconos = leer("icons.tsx");
    expect(iconos).toMatch(/export const ICONO_RAIL = 14;/);
    expect(iconos).toMatch(/export const ICONO_BARRA = 12;/);
  });

  // El corazón del guardia: en estos ficheros no puede aparecer un `size={13}`
  // ni un `size={14}` a mano. Los 10 y 11 SÍ se admiten — son los glifos
  // tipográficos que la lápida de arriba explica.
  it.each(CROMO)("%s no cablea 13 ni 14 a mano", (fichero) => {
    const fuente = leer(fichero);
    expect(fuente).not.toMatch(/size=\{13\}/);
    expect(fuente).not.toMatch(/size=\{14\}/);
  });

  // BRAZO DE CONTROL. Sin esto, un barrido que borrara los iconos de las barras
  // dejaría la prueba de arriba en verde sobre un fichero vacío.
  it("y las constantes se USAN de verdad en las barras y en el rail", () => {
    expect(leer("preview-area.tsx")).toMatch(/ICONO_BARRA/);
    expect(leer("address-bar.tsx")).toMatch(/ICONO_BARRA/);
    expect(leer("ui.tsx")).toMatch(/ICONO_BARRA/);
    expect(leer("left-sidebar.tsx")).toMatch(/ICONO_RAIL/);
  });
});

describe("las cápsulas", () => {
  it("hay UNA receta, no una por grupo", () => {
    const ui = leer("ui.tsx");
    expect(ui).toMatch(/export const CAPSULA =/);
    // Pista HUNDIDA: es lo que hace que lo activo, elevado, se lea como tal.
    expect(ui).toMatch(/bg-hover/);
  });

  // Los cuatro grupos de la barra del lienzo: dispositivo, zoom, lentes y
  // acciones. Los dos segmentados traen la suya de `Segmented`; los otros dos
  // la piden a mano.
  it("la barra del lienzo agrupa con cápsulas, no con rayas", () => {
    const fuente = leer("preview-area.tsx");
    expect((fuente.match(/CAPSULA/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // ⚰️ Los separadores `│` se fueron con ellas: una raya AL LADO de una
    // cápsula dice dos veces lo mismo.
    expect(fuente).not.toMatch(/w-px bg-\[color:var\(--border\)\]/);
  });

  // Un `IconBtn` dentro de una cápsula tiene que ELEVARSE, no hundirse: la
  // pista ya es `bg-hover`, así que un hover a `bg-hover` sería invisible y el
  // botón parecería no responder.
  it("un IconBtn en cápsula se eleva al apuntarlo", () => {
    const ui = leer("ui.tsx");
    expect(ui).toMatch(/enCapsula/);
    expect(ui).toMatch(/hover:bg-elev hover:shadow-card/);
  });
});
