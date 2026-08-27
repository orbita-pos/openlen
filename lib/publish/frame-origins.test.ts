import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * ESTE GUARDIA SE QUEDÓ SIN TRABAJO el 2026-08-26, y conviene dejar escrito por
 * qué.
 *
 * Vigilaba la misma verdad escrita en dos lenguajes: qué orígenes podía llevar
 * un `<iframe>` en una página publicada lo decidían los horneados de TypeScript
 * (que meten el iframe) y `seal.rs` (que pinaba `frame-src` en la CSP). Si se
 * separaban, el navegador bloqueaba el embebido EN LA PÁGINA PUBLICADA y en
 * ningún otro sitio — el editor lo enseñaba bien. Lo único que los unía era un
 * comentario, y por eso existía esta prueba.
 *
 * Ya no hay `frame-src` que sincronizar: las páginas publicadas salen SIN CSP.
 *
 * Lo que queda es el guardia de la decisión misma. Si alguien vuelve a meter
 * una política en el sellador, esto cae — y con ello vuelve la pregunta que
 * hay que contestar antes: qué la sostiene, y qué deja de funcionar. Que es
 * exactamente la conversación que se tuvo para quitarla.
 */
const SEAL = "crates/html-engine/src/publish/seal.rs";

describe("las páginas publicadas salen SIN CSP", () => {
  it("el sellador no construye ninguna política", () => {
    const src = readFileSync(path.join(process.cwd(), SEAL), "utf8");
    // Sin expresiones regulares: se busca el literal de la directiva tal y como
    // se escribiría dentro de una cadena de política.
    for (const directiva of [
      "script-src ",
      "connect-src ",
      "frame-src ",
      "img-src ",
      "form-action ",
    ]) {
      const lineas = src
        .split("\n")
        .filter((l) => l.includes(directiva) && !l.trimStart().startsWith("//"));
      expect(
        lineas,
        `seal.rs volvió a emitir \`${directiva.trim()}\` — si la CSP vuelve, hay que ` +
          `decidir antes qué la sostiene y qué deja de funcionar (cargar una ` +
          `librería de un CDN, hablar con una API, el script del propio modelo).`,
      ).toEqual([]);
    }
  });

  it("y no inyecta el <meta> de política", () => {
    const src = readFileSync(path.join(process.cwd(), SEAL), "utf8");
    const vivas = src
      .split("\n")
      .filter(
        (l) => l.includes("Content-Security-Policy") && !l.trimStart().startsWith("//"),
      );
    expect(vivas).toEqual([]);
  });
});
