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
  const fuente = () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "lib", "projects.ts"),
      "utf8",
    ) as string;

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
