// 🔴 I4 · EL GUARDIA: NINGÚN ESCRITOR DE `project.data` SE SALTA EL CAS.
//
// El primitivo (`escribir-data.ts`) sólo sirve si lo usan TODOS. Un `UPDATE
// projects SET data = …` suelto vuelve a abrir el agujero entero, y no se nota:
// compila, las pruebas pasan, y el trabajo de otro desaparece en producción sin
// que nadie falle.
//
// Por eso esto lee el FUENTE. Es la misma forma que `guardar-sin-leer-el-lienzo`
// y `sin-puente-ia-modulos` — vigilar que un camino retirado no vuelva — y la
// única que puede cubrir a un escritor que aún no existe.
//
// Contados el 2026-09-14: TRECE escritores de `data`. El comentario que había en
// `lib/agent/tools.ts` decía doce, y decía que el único con concurrencia
// optimista era el editor; las dos mitades eran falsas (ver la cabecera de
// `escribir-data.ts`).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const CARPETAS = ["app", "lib", "scripts"];

/** Quien tiene permiso para escribir `projects.data` a pelo, y por qué. */
const EXENTOS = new Set([
  // El primitivo. Es el único sitio donde el CAS puede vivir.
  "lib/projects/escribir-data.ts",
  // Escribe con `jsonb_set` sobre la clave `settings` y SÓLO sobre ella, con su
  // propio compare-and-swap (`settingsUnchanged`) y su reintento. No puede pisar
  // `html` ni `pages` ni queriendo: la sentencia no los nombra. Es el escritor
  // del que salió el patrón, no una excepción a él.
  "app/api/projects/[id]/settings/route.ts",
]);

function ficherosTs(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre === ".next") continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) ficherosTs(ruta, salida);
    else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

/** `update(schema.projects)` seguido de un `.set({ … data … })`, en el mismo
 *  encadenado. Se mira la ventana siguiente y no todo el fichero: un fichero
 *  puede tener varios UPDATE y sólo uno tocar `data`. */
const ESCRITURA = /\.update\(\s*schema\.projects\s*\)\s*[\s\S]{0,400}?\.set\(\s*\{([\s\S]{0,400}?)\}\s*\)/g;

function escritoresDeData(): string[] {
  const encontrados: string[] = [];
  for (const carpeta of CARPETAS) {
    for (const ruta of ficherosTs(join(RAIZ, carpeta))) {
      const fuente = readFileSync(ruta, "utf8");
      for (const m of fuente.matchAll(ESCRITURA)) {
        // `data:`, `data,` o el atajo `{ data }` dentro del `.set({…})`.
        // `publishedHtml`, `subdomain` y compañía son columnas propias y no
        // entran en este blob.
        //
        // ⚠️ El atajo estaba fuera de la primera versión de este patrón y se
        // comía un escritor entero (`app/api/projects/[id]/preview/route.ts`,
        // que hace `.set({ data })`): una guarda con un hueco es peor que no
        // tenerla, porque sale verde.
        if (!/(^|[\s,{])data\s*([:,]|$)/.test(m[1]!.trim())) continue;
        encontrados.push(relative(RAIZ, ruta).split(sep).join("/"));
      }
    }
  }
  return [...new Set(encontrados)].sort();
}

describe("I4 · todo escritor de project.data pasa por el compare-and-swap", () => {
  it("no hay ningún UPDATE de `data` fuera del primitivo", () => {
    const sueltos = escritoresDeData().filter((f) => !EXENTOS.has(f));
    expect(sueltos).toEqual([]);
  });

  it("y el primitivo sigue ahí (si se renombra, esta guarda se queda ciega)", () => {
    const fuente = readFileSync(join(RAIZ, "lib/projects/escribir-data.ts"), "utf8");
    expect(fuente).toContain("escribirDataSiNoSeMovio");
    expect(fuente).toContain("eq(schema.projects.updatedAt, params.baseUpdatedAt)");
  });
});
