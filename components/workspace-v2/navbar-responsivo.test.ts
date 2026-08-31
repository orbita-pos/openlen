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

import { sinComentarios } from "@/lib/sin-comentarios";

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

// La fuente SIN COMENTARIOS — para las aserciones que fijan una AUSENCIA: una
// prueba que no distingue una LLAMADA de una MENCIÓN obliga a elegir entre el
// guardia y la lápida que explica por qué algo se retiró, y en este repo esa
// explicación es justo lo que impide que vuelva. Vivía copiada en tres pruebas,
// con el mismo fallo de orden en las tres; ver `lib/sin-comentarios.ts`.
const leerCodigo = (rel: string) => sinComentarios(leer(rel));
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

  // ⚰️ Esto fijaba «el selector de idioma va COMPACTO aquí». Su inversa desde
  // el 2026-08-31: no va, punto. El selector se mudó al menú de cuenta, al pie
  // del rail, y con él se fue el prop `compact` — que se quedó sin un solo
  // consumidor.
  //
  // Es la misma decisión llevada más lejos: el problema no era que el nombre
  // del idioma se leyera, era que competía por una barra que habla del
  // PROYECTO. Esconder el texto lo tapaba; sacarlo lo resuelve.
  it("y el selector de idioma ya no está en la barra", () => {
    expect(BARRA).not.toMatch(/LocaleSwitcher/);
  });
});

describe("el idioma dice su nombre en los cuatro sitios que lo montan", () => {
  it.each([
    "components/marketing/nav.tsx",
    "components/app/app-header.tsx",
    "components/app/dashboard-shell.tsx",
  ])("%s lo monta entero", (rel) => {
    expect(leer(rel)).toMatch(/<LocaleSwitcher \/>/);
  });

  it("y el cuarto es el menú de cuenta, al pie del rail", () => {
    expect(leer("components/workspace-v2/account-menu.tsx")).toMatch(
      /<LocaleSwitcher className="w-full" \/>/,
    );
  });

  // BRAZO DE CONTROL del barrido: el prop se fue, no se quedó declarado sin
  // usar. Un prop que nadie pasa es código muerto que sigue hablando — el
  // próximo lector creería que hay un modo compacto disponible.
  it("y el prop `compact` ya no existe", () => {
    expect(leerCodigo("components/locale-switcher.tsx")).not.toMatch(/compact/);
  });
});
