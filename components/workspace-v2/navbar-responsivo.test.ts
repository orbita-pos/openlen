// LA BARRA DE /new EN PANTALLA ESTRECHA — 2026-08-29.
//
// Lo que se rompía, MEDIDO en Chromium a 390px con un proyecto cargado:
//
//   · «Workspace —» ocupaba 85px de `shrink-0` que no cedían nunca. El botón
//     entero quedaba en 32px, así que la etiqueta se pintaba cortada a mitad de
//     palabra («Works») y el guion quedaba huérfano, pintando encima del botón
//     de Deploy. A 480px el NOMBRE DEL PROYECTO desaparecía del todo y
//     sobrevivía la etiqueta — que no informa de nada: ya sabes que estás en el
//     taller.
//   · El nombre del idioma del selector medía 100px. MÁS QUE EL BOTÓN DE
//     DEPLOY, y el 26% de una barra de 390px.
//
// La prioridad estaba al revés: lo decorativo protegido, la identidad
// sacrificada. Esto fija la decisión, no el aspecto — un cambio de estilo no lo
// rompe, pero volver a proteger la decoración sí.
//
// Verificado a 16 anchos (1920 → 320): 0 rotos. El barrido buscaba texto
// cortado SIN puntos suspensivos, elementos fuera de la barra, y botones por
// debajo del mínimo tocable.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const BARRA = leer("components/workspace-v2/top-bar.tsx");

describe("en estrecho cede la decoración, no la identidad", () => {
  it("«Workspace —» se esconde debajo de lg", () => {
    const etiqueta = BARRA.match(/<span[^>]*>\{t\("projectName\.workspaceLabel"\)\}/);
    expect(etiqueta).not.toBeNull();
    expect(etiqueta![0]).toMatch(/hidden lg:inline/);
  });

  it("pero el NOMBRE del proyecto no se esconde a ningún ancho", () => {
    // BRAZO DE CONTROL del arreglo. Si alguien "resuelve" un desbordamiento
    // futuro escondiendo el nombre, vuelve el fallo original con otra cara: una
    // barra que no dice en qué proyecto estás.
    const nombre = BARRA.match(/<span className="([^"]*)">\s*\{projectName\}/);
    expect(nombre).not.toBeNull();
    expect(nombre![1]).toContain("truncate");
    expect(nombre![1]).not.toMatch(/\bhidden\b/);
  });

  it("y el selector de idioma va compacto AQUÍ", () => {
    expect(BARRA).toMatch(/<LocaleSwitcher compact \/>/);
  });
});

describe("compacto es opt-in: las otras superficies no se tocan", () => {
  // El selector lo usan cuatro sitios. En la nav de marketing y en el dashboard
  // no hay competencia por el espacio, así que allí el nombre del idioma se lee
  // entero. Comprobado en el navegador: 100px con «English» a 1440, 768 y 390.
  it.each([
    "components/marketing/nav.tsx",
    "components/app/app-header.tsx",
    "components/app/dashboard-shell.tsx",
  ])("%s lo monta sin compact", (rel) => {
    expect(leer(rel)).toMatch(/<LocaleSwitcher \/>/);
  });

  it("el componente esconde el nombre SÓLO si se lo piden", () => {
    const sw = leer("components/locale-switcher.tsx");
    // `compact &&` — sin la condición, la prop no serviría de nada y las otras
    // tres superficies perderían el nombre sin que nadie lo pidiera.
    expect(sw).toMatch(/compact && "hidden lg:inline"/);
  });
});
