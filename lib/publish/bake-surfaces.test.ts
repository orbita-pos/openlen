import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PUBLISH_ONLY_BAKES } from "./bake-surfaces";

// Lee los horneados que un fichero IMPORTA y además LLAMA.
//
// Sólo los importados: `bakeDocument` está definido dentro de filesystem.ts —
// es el contenedor de todos los demás, no uno de ellos.
//
// El patrón lleva dígito a propósito. La primera versión decía `bake[A-Z]` y
// se dejaba fuera `bake3dScene` en silencio (aquel horneado ya no existe, la
// lección sí): la prueba habría pasado con un
// horneado sin declarar. Es exactamente el fallo que esta prueba vigila,
// cometido dentro de la prueba misma.
function horneadosDe(rel: string): Set<string> {
  const src = readFileSync(path.join(process.cwd(), rel), "utf8");
  const importados = new Set<string>();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const bruto of m[1].split(",")) {
      const n = bruto.trim().split(" as ")[0]?.trim() ?? "";
      if (/^bake[A-Z0-9]/.test(n)) importados.add(n);
    }
  }
  // Sin expresión regular a propósito: una barra invertida perdida al
  // escribir el fichero convertía `\s` en `s` y el guardián pasaba en verde
  // sin comprobar nada. Dos `includes` no se pueden romper así.
  const llamado = (n: string) => src.includes(`${n}(`) || src.includes(`${n} (`);
  return new Set([...importados].filter(llamado));
}

const PUBLICAR = "lib/publish/filesystem.ts";
const VISTA_PREVIA = "lib/publish/preview-bake.ts";

describe("las superficies hornean lo mismo, o está declarado", () => {
  const publicar = horneadosDe(PUBLICAR);
  const previa = horneadosDe(VISTA_PREVIA);

  it("el extractor encuentra horneados en los dos ficheros", () => {
    // Si un refactor rompe el extractor, todo lo demás pasaría vacío y en
    // verde. Esta prueba es la que impide que el guardián se apague solo.
    //
    // EL SUELO BAJÓ DE 8 A 4 el 2026-08-26: se retiraron cuatro horneados
    // (carrusel, vídeo, mapas, conductas) porque existían sólo para suplir el
    // JavaScript prohibido. No es un número que haya que defender — es un suelo
    // contra «el extractor devolvió cero», y por eso va holgadamente por debajo
    // de lo que hay.
    expect(publicar.size).toBeGreaterThan(4);
    expect(previa.size).toBeGreaterThan(1);
  });

  it("todo lo que publica y la vista previa no, está declarado y explicado", () => {
    const soloAlPublicar = [...publicar].filter((b) => !previa.has(b)).sort();
    expect(soloAlPublicar).toEqual(Object.keys(PUBLISH_ONLY_BAKES).sort());
  });

  it("no hay entradas rancias: todo lo declarado sigue existiendo", () => {
    const fantasmas = Object.keys(PUBLISH_ONLY_BAKES).filter((b) => !publicar.has(b));
    expect(fantasmas, `ya no se hornean al publicar: ${fantasmas.join(", ")}`).toEqual([]);
  });

  it("la vista previa NUNCA hornea algo que la publicada no", () => {
    // La otra dirección del fallo, y la peor de las dos: enseñar en el editor
    // algo que el visitante jamás recibe.
    const inventados = [...previa].filter((b) => !publicar.has(b)).sort();
    expect(inventados).toEqual([]);
  });

  it("cada motivo dice algo, no es un hueco relleno", () => {
    for (const [bake, motivo] of Object.entries(PUBLISH_ONLY_BAKES)) {
      expect(motivo.length, `${bake} sin motivo de verdad`).toBeGreaterThan(40);
    }
  });
});

// ─── LA TERCERA SUPERFICIE ────────────────────────────────────────────────
//
// La cabecera de bake-surfaces.ts nombra TRES formas de pintar un proyecto —
// el taller, `/p/[id]` y la publicada— y este guardián sólo comparaba las dos
// últimas. Por ese hueco se coló el defecto del 2026-08-31: cuando los
// horneados de conductas y carrusel salieron de publicar Y de la vista previa
// (`3a4e2a97`, que además hizo bien las dos a la vez), el TALLER siguió
// inyectándolos por su cuenta. Resultado: el dueño veía su carrusel girar
// mientras editaba y al visitante le llegaba una lista muerta.
//
// Es la INVERSIÓN del fallo que este fichero se escribió para cazar, y la peor
// de las dos: el dueño no tiene ningún motivo para sospechar.
//
// El taller no llama a `bake*` —usa `inject*` de cliente— así que el extractor
// de arriba no le sirve. Lo que sí se puede afirmar, y es lo que importa: el
// lienzo NO puede inyectar un runtime que la página publicada no hornea.
describe("el taller no inyecta runtimes que la publicada ya no hornea", () => {
  const LIENZO = "components/workspace-v2/preview-area.tsx";
  const src = readFileSync(path.join(process.cwd(), LIENZO), "utf8");

  // Los dos runtimes que publicar dejó de hornear el 2026-08-26. Si alguien
  // devuelve su inyector al lienzo sin devolver también el horneado, aquí se
  // entera.
  const PROHIBIDOS = [
    ["el runtime de las conductas", "injectBehaviorsPreview"],
    ["el stash que ese runtime necesitaba", "stashBehaviorsPristineState"],
    ["la palanca que sólo servía para sincronizarlo", "useKillSwitches"],
  ] as const;

  for (const [queEs, simbolo] of PROHIBIDOS) {
    it(`el lienzo no usa ${queEs}`, () => {
      expect(src).not.toContain(simbolo);
    });
  }

  // Y el guardián se guarda a sí mismo: si el fichero del lienzo se renombra,
  // `src` sería "" y los tres `not.toContain` pasarían sin comprobar nada.
  it("el extractor está leyendo el lienzo de verdad", () => {
    expect(src).toContain("injectInlineEdit");
  });
});
