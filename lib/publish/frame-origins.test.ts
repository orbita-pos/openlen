import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { VIDEO_FRAME_ORIGINS } from "./video-embed";
import { MAP_FRAME_ORIGINS } from "./map-embed";

// La misma verdad escrita en dos lenguajes.
//
// Qué orígenes puede llevar un <iframe> en una página publicada lo deciden dos
// sitios: los horneados de TypeScript, que meten el iframe, y `seal.rs`, que
// pina `frame-src` en la CSP. Si se separan, el navegador bloquea el embebido
// EN LA PÁGINA PUBLICADA y en ningún otro sitio — el editor lo enseña bien.
//
// Y separarlos es fácil: son lenguajes distintos, ficheros distintos, y tocar
// el de Rust obliga a recompilar el módulo nativo. Lo único que los unía era un
// comentario. Ahora, esto.

const SEAL = "crates/html-engine/src/publish/seal.rs";

/** Los orígenes del `frame-src` que construye el sellador. Sin expresiones
 *  regulares: una barra invertida perdida deja al guardián comprobando nada. */
function frameSrcDeRust(): string[] {
  const src = readFileSync(path.join(process.cwd(), SEAL), "utf8");
  const marca = "frame-src ";
  // La primera aparición dentro de una cadena de política, no la de los tests
  // ni la de los comentarios: la política lleva el `;` de cierre detrás.
  for (const linea of src.split("\n")) {
    const i = linea.indexOf(marca);
    if (i === -1) continue;
    const resto = linea.slice(i + marca.length);
    const fin = resto.indexOf(";");
    if (fin === -1) continue;
    const partes = resto
      .slice(0, fin)
      .split(" ")
      .map((t) => t.trim())
      .filter((t) => t.startsWith("https://"));
    if (partes.length > 0) return partes;
  }
  return [];
}

describe("frame-src: Rust y TypeScript dicen lo mismo", () => {
  const rust = frameSrcDeRust();
  const ts = [...VIDEO_FRAME_ORIGINS, ...MAP_FRAME_ORIGINS];

  it("el lector encuentra la política en seal.rs", () => {
    // Si un refactor mueve la cadena, esto salta antes de que el guardián
    // empiece a comparar dos listas vacías y pase en verde.
    expect(rust.length, `no encontré frame-src en ${SEAL}`).toBeGreaterThan(0);
  });

  it("los orígenes coinciden exactamente", () => {
    expect([...rust].sort()).toEqual([...ts].sort());
  });

  it("cada origen declarado se usa de verdad en su propio horneado", () => {
    // Una constante que nadie usa es peor que no tenerla: pasa la prueba y no
    // describe el código.
    const video = readFileSync(path.join(process.cwd(), "lib/publish/video-embed.ts"), "utf8");
    for (const o of VIDEO_FRAME_ORIGINS) {
      expect(video.split(o).length - 1, `${o} declarado pero sin usar`).toBeGreaterThan(1);
    }
    const mapa = readFileSync(path.join(process.cwd(), "lib/publish/map-embed.ts"), "utf8");
    for (const o of MAP_FRAME_ORIGINS) expect(mapa).toContain(o);
  });
});
