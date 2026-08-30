import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { leerDeclaracion } from "./declaracion";

// La extracción al publicar es `leerDeclaracion` aplicada al HTML que se
// publica. Lo que estas pruebas fijan es la PROPIEDAD que importa, para que el
// cableado en lib/projects.ts no pueda cambiarla sin que se note.
describe("extracción al publicar", () => {
  it("una página sin bloque no declara nada", () => {
    expect(leerDeclaracion("<html><body><h1>hola</h1></body></html>")).toEqual({});
  });

  it("una página que quita su bloque deja de declarar", () => {
    const antes = leerDeclaracion(
      '<script type="application/json" data-ol-stores>{"a":{"visitante":"propio","campos":{}}}</script>',
    );
    expect(Object.keys(antes)).toEqual(["a"]);
    expect(leerDeclaracion("<html></html>")).toEqual({});
  });
});

// El cableado en sí: publicar SIEMPRE escribe la declaración, no sólo cuando se
// tocan los idiomas. `publishProject` sólo incluía `data` en el update si
// `persistLanguages` era cierto — un almacén nuevo no habría llegado nunca a la
// base salvo que el usuario, además, cambiara los idiomas de la página.
describe("el cableado en publishProject", () => {
  // `readFileSync`/`join` importados arriba, como el resto de lápidas de este
  // repo. Antes iba con `require()` y un `eslint-disable` de
  // `@typescript-eslint/no-require-imports` — una regla que NO está en el
  // `.eslintrc.json` de este proyecto. Desactivar una regla inexistente es un
  // ERROR de lint, y tumbó el build del deploy (2026-08-29) cuando ni `tsc`
  // ni `npm test` lo veían: ninguno de los dos pasa el linter.
  const fuente = () =>
    readFileSync(join(process.cwd(), "lib", "projects.ts"), "utf8");

  it("extrae la declaración del HTML que se publica", () => {
    expect(fuente()).toContain("leerDeclaracion(html)");
  });

  it("escribe `data` en CADA publicación, no sólo al cambiar idiomas", () => {
    const src = fuente();
    // La forma vieja: `data` sólo dentro del spread condicional.
    expect(src).not.toMatch(/\.\.\.\(persistLanguages && project\.data\s*\r?\n?\s*\?\s*\{\s*\r?\n?\s*data:/);
    expect(src).toContain("almacenes");
  });
});
