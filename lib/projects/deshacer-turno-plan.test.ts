// @vitest-environment node
// QUÉ SE DESHACE DE UN TURNO (F2 de las apps web): todo o nada, y nada si el
// dueño tocó después lo mismo que tocó Len.
import { describe, expect, it } from "vitest";
import { cambiosDelTurnoParaDeshacer, esDeshacible, planearDeshacer, type CambioDelTurno } from "./deshacer-turno-plan";
import type { ProjectData } from "@/lib/projects/types";

describe("qué vuelve al deshacer un turno", () => {
  it("las páginas y la carpeta, sí; /supabase, /memoria y /ajustes, no", () => {
    for (const r of ["/index.html", "/menu/index.html", "/src/App.jsx", "/js/app.js", "/tests/a.spec.ts", "/data/x.json"]) {
      expect(esDeshacible(r), r).toBe(true);
    }
    for (const r of ["/supabase/migrations/20261007000000_x.sql", "/memoria/proyecto.md", "/ajustes/proyecto.json"]) {
      expect(esDeshacible(r), r).toBe(false);
    }
  });

  it("de las dos fotos sale lo que cambió, con su contenido sólo si vuelve", () => {
    const antes = {
      "/index.html": "<p>a</p>",
      "/src/App.jsx": "v1",
      "/src/Viejo.jsx": "x",
      "/supabase/migrations/1_a.sql": "create table a();",
      "/AGENTS.md": "manual",
    };
    const despues = {
      "/index.html": "<p>b</p>",
      "/src/App.jsx": "v2",
      "/src/Nuevo.jsx": "n",
      "/supabase/migrations/1_a.sql": "create table a();",
      "/supabase/migrations/2_b.sql": "create table b();",
      "/AGENTS.md": "otro manual",
    };
    expect(cambiosDelTurnoParaDeshacer(antes, despues)).toEqual([
      { ruta: "/index.html", antes: "<p>a</p>", despues: "<p>b</p>", deshacible: true },
      { ruta: "/src/App.jsx", antes: "v1", despues: "v2", deshacible: true },
      { ruta: "/src/Nuevo.jsx", antes: null, despues: "n", deshacible: true },
      { ruta: "/src/Viejo.jsx", antes: "x", despues: null, deshacible: true },
      { ruta: "/supabase/migrations/2_b.sql", antes: null, despues: null, deshacible: false },
    ]);
  });
});

describe("planearDeshacer", () => {
  const data: ProjectData = {
    html: '<p data-op-id="a1">b</p>',
    pages: { menu: { html: "<h1>menú 2</h1>", title: "Menú" }, nueva: { html: "<h1>nueva</h1>" } },
  };
  const ficheros = { "/src/App.jsx": "v2", "/src/Nuevo.jsx": "n", "/css/x.css": "intacto" };
  const cambios: CambioDelTurno[] = [
    { ruta: "/index.html", antes: "<p>a</p>", despues: "<p>b</p>", deshacible: true },
    { ruta: "/menu/index.html", antes: "<h1>menú 1</h1>", despues: "<h1>menú 2</h1>", deshacible: true },
    { ruta: "/nueva/index.html", antes: null, despues: "<h1>nueva</h1>", deshacible: true },
    { ruta: "/src/App.jsx", antes: "v1", despues: "v2", deshacible: true },
    { ruta: "/src/Nuevo.jsx", antes: null, despues: "n", deshacible: true },
    { ruta: "/src/Viejo.jsx", antes: "x", despues: null, deshacible: true },
    { ruta: "/supabase/migrations/2_b.sql", antes: null, despues: null, deshacible: false },
  ];

  it("🔴 todo vuelve a como estaba al empezar el turno, en un solo plan", () => {
    const p = planearDeshacer(cambios, { data, ficheros });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.data.html).toBe("<p>a</p>");
    expect(p.data.pages?.menu).toEqual({ html: "<h1>menú 1</h1>", title: "Menú" });
    expect(p.data.pages?.nueva).toBeUndefined();
    expect(p.escribir).toEqual([
      { path: "/src/App.jsx", content: "v1" },
      { path: "/src/Viejo.jsx", content: "x" },
    ]);
    expect(p.borrar).toEqual(["/src/Nuevo.jsx"]);
    expect(p.esperados).toEqual([
      { path: "/src/App.jsx", content: "v2" },
      { path: "/src/Nuevo.jsx", content: "n" },
      { path: "/src/Viejo.jsx", content: null },
    ]);
    expect(p.ficheros).toEqual(["/src/App.jsx", "/src/Nuevo.jsx", "/src/Viejo.jsx"]);
    expect(p.paginas).toEqual([
      { page: null, html: "<p>a</p>" },
      { page: "menu", html: "<h1>menú 1</h1>" },
    ]);
    expect(p.noSeDeshacen).toEqual(["/supabase/migrations/2_b.sql"]);
  });

  it("las páginas se comparan sin data-op-id, como en la foto: no es un choque", () => {
    const p = planearDeshacer(cambios.slice(0, 1), { data, ficheros });
    expect(p.ok).toBe(true);
  });

  it("🔴 si el dueño cambió DESPUÉS un fichero del turno, no se deshace NADA y se dice cuál", () => {
    const p = planearDeshacer(cambios, { data, ficheros: { ...ficheros, "/src/App.jsx": "v2 + lo del dueño" } });
    expect(p).toEqual({ ok: false, motivo: "se_solapan", rutas: ["/src/App.jsx"] });
  });

  it("lo mismo con una página, con un fichero que el turno borró y vuelve a existir, o uno creado que ya no está", () => {
    expect(planearDeshacer(cambios, { data: { ...data, html: "<p>c</p>" }, ficheros })).toMatchObject({ rutas: ["/index.html"] });
    expect(planearDeshacer(cambios, { data, ficheros: { ...ficheros, "/src/Viejo.jsx": "otra vez" } })).toMatchObject({ rutas: ["/src/Viejo.jsx"] });
    const sinNuevo = { "/src/App.jsx": "v2" };
    expect(planearDeshacer(cambios, { data, ficheros: sinNuevo })).toMatchObject({ rutas: ["/src/Nuevo.jsx"] });
  });

  it("CONTRA-PRUEBA: un fichero que el turno no tocó puede cambiar sin impedir nada", () => {
    expect(planearDeshacer(cambios, { data, ficheros: { ...ficheros, "/css/x.css": "cambiado por el dueño" } }).ok).toBe(true);
  });

  it("un turno que sólo cambió lo que no vuelve no tiene nada que deshacer, y lo dice", () => {
    expect(planearDeshacer([cambios[6]!], { data, ficheros })).toEqual({
      ok: false,
      motivo: "sin_cambios",
      noSeDeshacen: ["/supabase/migrations/2_b.sql"],
    });
  });

  it("el inverso deshace el deshacer", () => {
    const p = planearDeshacer(cambios, { data, ficheros });
    if (!p.ok) throw new Error("no");
    const otraVez = planearDeshacer(p.inverso, {
      data: p.data,
      ficheros: { ...Object.fromEntries(p.escribir.map((e) => [e.path, e.content])), "/css/x.css": "intacto" },
    });
    expect(otraVez.ok).toBe(true);
    if (!otraVez.ok) return;
    expect(otraVez.data.html).toBe("<p>b</p>");
    expect(otraVez.data.pages?.nueva?.html).toBe("<h1>nueva</h1>");
    expect(otraVez.escribir).toEqual([
      { path: "/src/App.jsx", content: "v2" },
      { path: "/src/Nuevo.jsx", content: "n" },
    ]);
    expect(otraVez.borrar).toEqual(["/src/Viejo.jsx"]);
  });
});
