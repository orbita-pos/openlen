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

  // ⚰️ Esta prueba exigía TRES cápsulas en `preview-area.tsx` — zoom,
  // acciones y las dos segmentadas— y saltó en rojo con la maqueta del
  // 2026-08-31, que es justo para lo que está.
  //
  // La maqueta usa MENOS: las únicas cápsulas son las de los dos segmentados
  // (lente y dispositivo), que las traen de `Segmented`; el zoom y «Ajustar»
  // son píldoras con borde propio, y las acciones van desnudas. Lo que sigue
  // siendo cierto —y es lo que esta prueba fija ahora— es que agrupar se hace
  // con una cápsula y no con una raya.
  it("la barra del lienzo agrupa con cápsulas, no con rayas", () => {
    const fuente = leer("preview-area.tsx");
    // Los dos segmentados siguen ahí, y su cápsula es la compún.
    expect((fuente.match(/<Segmented</g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(leer("ui.tsx")).toMatch(/\$\{CAPSULA\}/);
    // Ni una raya vertical: la cápsula ya separa.
    expect(fuente).not.toMatch(/w-px bg-\[color:var\(--border\)\]/);
  });

  // LAS DOS FILAS de la maqueta. Arriba lo que decide QUÉ se mira (lente,
  // dirección, acciones); abajo, centrado, lo que sólo ENCUADRA.
  it("el encuadre vive en su propia fila, centrado y sólo con la página delante", () => {
    const fuente = leer("preview-area.tsx");
    expect(fuente).toMatch(/lente === "pagina" && \([\s\S]{0,400}?justify-center/);
  });

  // BRAZO DE CONTROL del suelo que impide el lienzo en negro. Una fila extra
  // encima del contenedor medido fue lo que lo destapó el 2026-08-27, y este
  // diseño vuelve a añadir una.
  it("y `fitScale` sigue teniendo suelo, que es lo que hace segura la fila", () => {
    expect(leer("preview-area.tsx")).toMatch(/Math\.max\(0\.05,/);
  });
});
