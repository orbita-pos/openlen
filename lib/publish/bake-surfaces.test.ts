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
// se dejaba fuera `bake3dScene` en silencio: la prueba habría pasado con un
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
    expect(publicar.size).toBeGreaterThan(8);
    expect(previa.size).toBeGreaterThan(3);
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
