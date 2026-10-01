// @vitest-environment node
// Guardia: cada ruta de la lista decide quién eres con la llave o la sesión,
// lleva CORS y contesta OPTIONS; y una ruta de fuera NO acepta la llave.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUTAS_DE_LA_APP } from "./rutas-de-la-app";

const leer = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

describe("las rutas de la app", () => {
  for (const r of RUTAS_DE_LA_APP) {
    it(`${r.fichero}: ${r.metodos.join(", ")} con la llave, CORS y OPTIONS`, () => {
      const src = leer(r.fichero);
      if (!r.fichero.endsWith("movil/llave/route.ts")) expect(src).toContain("usuarioDeLaPeticion(req)");
      for (const m of r.metodos) expect(src).toMatch(new RegExp(`export const ${m} = paraLaApp\\(`));
      expect(src).toMatch(/export const OPTIONS = respuestaPrevia;/);
    });
  }

  it("una ruta de fuera de la lista sigue sólo con la sesión", () => {
    const src = leer("app/api/projects/[id]/versions/route.ts");
    expect(src).not.toContain("usuarioDeLaPeticion");
  });
});
