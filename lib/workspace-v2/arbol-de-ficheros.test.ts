// lib/workspace-v2/arbol-de-ficheros.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { abiertasAlEntrar, arbolDeFicheros, carpetasConMarca, marcasDeCambios, type NodoDelArbol } from "./arbol-de-ficheros";

const RUTAS = [
  { ruta: "/index.html" },
  { ruta: "/menu/index.html" },
  { ruta: "/datos/reservas.json" },
  { ruta: "/memoria/dueno.md" },
  { ruta: "/ajustes/proyecto.json" },
  { ruta: "/bandeja/formularios.jsonl", perezoso: true },
  { ruta: "/.versiones/v1/index.html", perezoso: true },
];

const plano = (ns: readonly NodoDelArbol[], sangria = ""): string[] =>
  ns.flatMap((n) => [`${sangria}${n.tipo === "carpeta" ? `${n.nombre}/` : n.nombre}${n.perezoso ? " (perezoso)" : ""}${n.soloLectura ? " [sólo lectura]" : ""}`, ...plano(n.hijos, `${sangria}  `)]);

describe("arbolDeFicheros", () => {
  it("por carpetas, carpetas primero y por nombre, como el explorador de VS Code", () => {
    expect(plano(arbolDeFicheros(RUTAS))).toEqual([
      ".versiones/ [sólo lectura]",
      "  v1/ [sólo lectura]",
      "    index.html (perezoso) [sólo lectura]",
      "ajustes/",
      "  proyecto.json",
      "bandeja/ [sólo lectura]",
      "  formularios.jsonl (perezoso) [sólo lectura]",
      "datos/",
      "  reservas.json",
      "memoria/",
      "  dueno.md",
      "menu/",
      "  index.html",
      "index.html",
    ]);
  });

  it("las carpetas de sólo lectura empiezan plegadas, salvo la que lleva al fichero elegido", () => {
    const arbol = arbolDeFicheros(RUTAS);
    expect([...abiertasAlEntrar(arbol, "/index.html")].sort()).toEqual(["/ajustes", "/datos", "/memoria", "/menu"]);
    expect(abiertasAlEntrar(arbol, "/bandeja/formularios.jsonl").has("/bandeja")).toBe(true);
  });
});

describe("marcasDeCambios — lo que cambió en la SESIÓN, para el árbol (la #19)", () => {
  const texto = (ruta: string, antes: string | null, despues: string | null) => ({ ruta, tipo: "texto" as const, antes, despues });

  it("nuevo, cambiado y los grandes por sus banderas", () => {
    const marcas = marcasDeCambios([
      {
        ficheros: [
          texto("/clases/index.html", null, "x"),
          texto("/index.html", "a", "b"),
          { ruta: "/menu/index.html", tipo: "grande", nuevo: false, borrado: false },
          { ruta: "/datos/fotos.json", tipo: "grande", nuevo: true, borrado: false },
        ],
      },
    ]);
    expect(Object.fromEntries(marcas)).toEqual({
      "/clases/index.html": "nuevo",
      "/index.html": "cambiado",
      "/menu/index.html": "cambiado",
      "/datos/fotos.json": "nuevo",
    });
  });

  it("creado en un turno y retocado en otro sigue siendo nuevo; creado y borrado, sin marca", () => {
    const marcas = marcasDeCambios([
      { ficheros: [texto("/clases/index.html", null, "x"), texto("/promo/index.html", null, "p")] },
      { ficheros: [texto("/clases/index.html", "x", "y"), texto("/promo/index.html", "p", null)] },
    ]);
    expect(Object.fromEntries(marcas)).toEqual({ "/clases/index.html": "nuevo" });
  });

  it("las carpetas con algo marcado dentro, a cualquier profundidad", () => {
    const marcas = marcasDeCambios([{ ficheros: [texto("/datos/2026/reservas.json", "a", "b"), texto("/index.html", "a", "b")] }]);
    expect([...carpetasConMarca(marcas)].sort()).toEqual(["/datos", "/datos/2026"]);
  });
});
