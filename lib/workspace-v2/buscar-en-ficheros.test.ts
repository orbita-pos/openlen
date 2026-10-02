import { describe, expect, it } from "vitest";

import { buscarEnFicheros, normalizar } from "./buscar-en-ficheros";

const SITIO = [
  { ruta: "/index.html", contenido: "<h1>Tienda Brote</h1>\n<p>Tel 55 1234 5678</p>\n<a href=\"/menu/\">Menú</a>" },
  { ruta: "/menu/index.html", contenido: "<h1>Menú</h1>\n<p>Tel 55 1234 5678</p>" },
  { ruta: "/datos/reservas.json", contenido: '[{"nombre":"Ana"}]' },
  { ruta: "/resultados/visitas.json", contenido: null },
];

describe("buscarEnFicheros — primero los nombres, después las líneas, por fichero", () => {
  it("por nombre y por dentro, sin mayúsculas ni acentos", () => {
    const r = buscarEnFicheros(SITIO, "menu");
    expect(r.porNombre).toEqual(["/menu/index.html"]);
    expect(r.enFicheros.map((f) => [f.ruta, f.lineas.map((l) => l.linea)])).toEqual([
      ["/index.html", [3]],
      ["/menu/index.html", [1]],
    ]);
    // Lo que casó, con sus letras de verdad: «Menú», no «menu».
    const menu = r.enFicheros[1]!.lineas[0]!;
    expect(menu.casa).toBe("Menú");
    expect(menu.antes + menu.casa + menu.despues).toBe("<h1>Menú</h1>");
  });

  it("los que aún no se calcularon se buscan por nombre y se cuentan", () => {
    const r = buscarEnFicheros(SITIO, "visitas");
    expect(r.porNombre).toEqual(["/resultados/visitas.json"]);
    expect(r.enFicheros).toEqual([]);
    expect(r.sinContenido).toBe(1);
  });

  it("una línea larga se corta alrededor de lo que casó, con poco delante para que se vea", () => {
    const larga = `${"a".repeat(100)}AGUJA${"b".repeat(100)}`;
    const [l] = buscarEnFicheros([{ ruta: "/x.html", contenido: larga }], "aguja").enFicheros[0]!.lineas;
    expect(l!.casa).toBe("AGUJA");
    expect(l!.antes).toBe(`…${"a".repeat(12)}`);
    expect(l!.despues).toBe(`${"b".repeat(60)}…`);
  });

  it("por encima del tope, se dice cuántas líneas faltan", () => {
    const r = buscarEnFicheros([{ ruta: "/x.txt", contenido: Array.from({ length: 10 }, () => "tel").join("\n") }], "tel", 4);
    expect(r.enFicheros[0]!.lineas).toHaveLength(4);
    expect(r.mas).toBe(6);
  });

  it("sin consulta, nada", () => {
    expect(buscarEnFicheros(SITIO, "   ")).toEqual({ porNombre: [], enFicheros: [], mas: 0, sinContenido: 0 });
  });
});

describe("normalizar", () => {
  it("una letra por letra: las posiciones de la línea siguen valiendo", () => {
    for (const s of ["Menú", "ÑANDÚ", "çà", "İstanbul", "emoji 🌊 ok"]) expect(normalizar(s)).toHaveLength(s.length);
    expect(normalizar("Menú Ñandú")).toBe("menu nandu");
  });
});
