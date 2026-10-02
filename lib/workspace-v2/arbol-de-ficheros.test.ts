// lib/workspace-v2/arbol-de-ficheros.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { abiertasAlEntrar, arbolDeFicheros, type NodoDelArbol } from "./arbol-de-ficheros";

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
