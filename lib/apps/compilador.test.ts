// @vitest-environment node
// El compilador de la app (spec local 2026-10-07-apps, §5.2): lo que los
// modelos escriben por reflejo —código «de Vite»— sale como JavaScript que un
// navegador ejecuta sin bundler, con las líneas en su sitio.
import { describe, expect, it } from "vitest";
import { compilarCarpeta, compilarFuente, esFuenteCompilable, textoDeDiagnostico, usesTailwindDirectives, type ContextoDeCompilacion } from "./compilador";
import { CATALOGO_ACTUAL } from "./dependencias";

const app = (carpeta: Record<string, string>, entorno?: Record<string, string>): ContextoDeCompilacion => ({
  carpeta,
  catalogo: CATALOGO_ACTUAL,
  ...(entorno ? { entorno } : {}),
});

function ok(r: ReturnType<typeof compilarFuente>): string {
  if (!r.ok) throw new Error(r.errores.map(textoDeDiagnostico).join("\n"));
  return r.js;
}

describe("qué pasa por el compilador", () => {
  it(".jsx, .tsx y .ts siempre; .js y .mjs sólo en una app", () => {
    for (const r of ["/src/App.jsx", "/src/App.tsx", "/src/util.ts"]) {
      expect(esFuenteCompilable(r, false), r).toBe(true);
      expect(esFuenteCompilable(r, true), r).toBe(true);
    }
    expect(esFuenteCompilable("/js/app.js", false)).toBe(false);
    expect(esFuenteCompilable("/js/app.js", true)).toBe(true);
    expect(esFuenteCompilable("/js/app.mjs", true)).toBe(true);
    for (const r of ["/css/site.css", "/data/x.json", "/sw.txt"]) expect(esFuenteCompilable(r, true), r).toBe(false);
  });
});

describe("JSX y TypeScript, con las líneas en su sitio", () => {
  const FUENTE = [
    'import { useState } from "react";', // 1
    "type Item = { precio: number };", // 2
    "export default function Carrito() {", // 3
    "  const [items] = useState<Item[]>([]);", // 4
    "  const total = items.reduce((s, i) => s + i.precio, 0);", // 5
    '  return <div className="p-4">{total} {items?.length ?? 0}</div>;', // 6
    "}", // 7
  ].join("\n");

  it("traduce JSX al runtime automático y quita los tipos", () => {
    const js = ok(compilarFuente("/src/Carrito.tsx", FUENTE, app({ "/src/Carrito.tsx": FUENTE })));
    expect(js).toContain('from "react/jsx-runtime"');
    expect(js).not.toMatch(/type Item|<Item\[\]>/);
    expect(js).not.toContain("<div");
  });

  it("🔴 la línea N del fuente es la línea N de la salida", () => {
    const js = ok(compilarFuente("/src/Carrito.tsx", FUENTE, app({ "/src/Carrito.tsx": FUENTE })));
    expect(js.split("\n").length).toBe(FUENTE.split("\n").length);
    expect(js.split("\n")[4]).toContain("items.reduce");
    expect(js.split("\n")[5]).toContain('className: "p-4"');
  });

  it("no baja de versión el JavaScript moderno (?. y ?? llegan tal cual)", () => {
    const js = ok(compilarFuente("/src/Carrito.tsx", FUENTE, app({ "/src/Carrito.tsx": FUENTE })));
    expect(js).toContain("items?.length ?? 0");
  });

  it("un .ts con genéricos en flecha compila (sin JSX que lo confunda)", () => {
    const f = "export const id = <T,>(x: T): T => x;\nexport enum Estado { Abierta, Cerrada }\n";
    expect(ok(compilarFuente("/src/util.ts", f, app({ "/src/util.ts": f })))).toContain("Estado");
  });

  it("un error de sintaxis dice fichero, línea y columna", () => {
    const r = compilarFuente("/src/Roto.jsx", "const a = 1;\nexport default () => <div>", app({}));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errores[0]).toMatchObject({ ruta: "/src/Roto.jsx", linea: 2 });
    expect(textoDeDiagnostico(r.errores[0]!)).toMatch(/^\/src\/Roto\.jsx:2:\d+ — /);
  });
});

describe("los imports", () => {
  const CARPETA = {
    "/src/main.jsx": "",
    "/src/App.tsx": "",
    "/src/components/Contador.jsx": "",
    "/src/lib/index.ts": "",
    "/src/datos/menu.json": "[]",
    "/src/index.css": "body{}",
    "/src/logo.svg": "<svg/>",
  };

  it("sin extensión, con @/ y con index: se reescriben a la ruta real", () => {
    const f = [
      'import App from "./App";',
      'import Contador from "@/components/Contador";',
      'import { x } from "./lib";',
      'export { y } from "../src/lib/index.ts";',
      'const Lazy = () => import("./components/Contador");',
    ].join("\n");
    const r = compilarFuente("/src/main.jsx", f, app(CARPETA));
    const js = ok(r);
    expect(js).toContain('from "/src/App.tsx"');
    expect(js).toContain('from "/src/components/Contador.jsx"');
    expect(js).toContain('from "/src/lib/index.ts"');
    expect(js).toContain('import("/src/components/Contador.jsx")');
    expect(r.ok && r.locales).toEqual(["/src/App.tsx", "/src/components/Contador.jsx", "/src/lib/index.ts"]);
  });

  it("🔴 export * from (el fichero barril de shadcn) también se reescribe; y si no existe, lo dice", () => {
    const r = compilarFuente("/src/lib/todo.ts", 'export * from "./index";\nexport * from "react-router-dom";', app(CARPETA));
    const js = ok(r);
    expect(js).toContain('export * from "/src/lib/index.ts"');
    expect(js).toContain('export * from "react-router-dom"');
    expect(r.ok && r.locales).toEqual(["/src/lib/index.ts"]);
    const roto = compilarFuente("/src/lib/todo.ts", 'export * from "./no-esta";', app(CARPETA));
    expect(roto.ok ? [] : roto.errores.map((e) => e.mensaje)).toEqual([expect.stringContaining('Cannot find "./no-esta"')]);
  });

  it("un nombre del catálogo se deja: lo resuelve el import map", () => {
    const f = 'import { createRoot } from "react-dom/client";\nimport { createClient } from "@supabase/supabase-js";\ncreateRoot; createClient;';
    const js = ok(compilarFuente("/src/main.jsx", f, app(CARPETA)));
    expect(js).toContain('from "react-dom/client"');
    expect(js).toContain('from "@supabase/supabase-js"');
  });

  it("🔴 un nombre que no está en el catálogo es un error con su línea y lo que sí hay", () => {
    const r = compilarFuente("/src/App.tsx", 'import x from "react";\nimport axios from "axios";\naxios; x;', app(CARPETA));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]).toMatchObject({ ruta: "/src/App.tsx", linea: 2 });
    expect(r.errores[0]!.mensaje).toMatch(/"axios" is not available in this app\. Available packages: react, /);
  });

  it("un import de una URL o de node: no se resuelve, y lo dice", () => {
    const r = compilarFuente("/src/App.tsx", 'import a from "https://esm.sh/lodash";\nimport fs from "node:fs";\na; fs;', app(CARPETA));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.map((e) => e.mensaje).join("\n")).toMatch(/URLs or "https:".*\n.*URLs or "node:"/s);
  });

  it("en una PÁGINA (sin catálogo) ningún nombre se resuelve", () => {
    const r = compilarFuente("/js/x.ts", 'import { useState } from "react";\nuseState;', { carpeta: {}, catalogo: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores[0]!.mensaje).toMatch(/can only be imported in an app/);
  });

  it("un fichero que no existe es un error, y no se sale de la raíz", () => {
    for (const espec of ["./NoExiste", "../../../etc/passwd"]) {
      const r = compilarFuente("/src/App.tsx", `import a from "${espec}";\na;`, app(CARPETA));
      expect(r.ok, espec).toBe(false);
      if (!r.ok) expect(r.errores[0]!.mensaje).toMatch(/Cannot find/);
    }
  });

  it("import \"./x.css\" se vuelve un <link>, en la misma línea", () => {
    const f = 'import "./index.css";\nexport const a = 1;';
    const js = ok(compilarFuente("/src/main.jsx", f, app(CARPETA)));
    expect(js).not.toMatch(/import\s*["']\.\/index\.css/);
    expect(js).toContain('l.href="/src/index.css"');
    expect(js.split("\n")).toHaveLength(2);
    expect(js.split("\n")[1]).toBe("export const a = 1;");
  });

  it("una hoja con directivas de Tailwind se inyecta como <style type=\"text/tailwindcss\">, en la misma línea", () => {
    const css = "@layer base { :root { --background: 0 100% 50%; } }\n.btn { @apply bg-primary; }";
    const js = ok(compilarFuente("/src/main.jsx", 'import "./index.css";\nexport const a = 1;', app({ ...CARPETA, "/src/index.css": css })));
    expect(js).toContain('s.type="text/tailwindcss"');
    expect(js).toContain(JSON.stringify(css));
    expect(js).not.toContain("l.href=");
    expect(js.split("\n")).toHaveLength(2);
    expect(js.split("\n")[1]).toBe("export const a = 1;");
  });

  it("CSS hostil dentro del módulo: el JS sigue siendo válido y el texto llega idéntico", () => {
    const css = '.a { @apply p-2 } /* "</script>` ${x} \\u2028 */';
    const js = ok(compilarFuente("/src/main.jsx", 'import "./index.css";', app({ ...CARPETA, "/src/index.css": css })));
    const nodo = { type: "", textContent: "", setAttribute() {} };
    const documento = { querySelector: () => null, createElement: () => nodo, head: { append() {} } };
    new Function("document", js)(documento);
    expect(nodo.type).toBe("text/tailwindcss");
    expect(nodo.textContent).toBe(css);
  });

  it("dos módulos que importan la misma hoja: se inyecta una sola vez", () => {
    const css = ".btn { @apply p-2; }";
    const js = ok(compilarFuente("/src/main.jsx", 'import "./index.css";', app({ ...CARPETA, "/src/index.css": css })));
    let puesto: unknown = null;
    let veces = 0;
    const documento = {
      querySelector: () => puesto,
      createElement: () => ({ setAttribute() {} }),
      head: {
        append: (n: unknown) => {
          puesto = n;
          veces++;
        },
      },
    };
    new Function("document", js)(documento);
    new Function("document", js)(documento);
    expect(veces).toBe(1);
  });

  it("usesTailwindDirectives: sólo lo que el navegador no entiende", () => {
    for (const si of ["@apply p-2", "@layer base {}", "@tailwind base;", "a { color: theme(colors.red.500) }", "@screen md { a {} }", "@config './x.js';"]) {
      expect(usesTailwindDirectives(si), si).toBe(true);
    }
    for (const no of ["body{}", "@media (min-width: 1px) { a {} }", "@import url(x.css);", "@font-face { font-family: X }", "@keyframes x { from {} }", ".applyish { color: red }"]) {
      expect(usesTailwindDirectives(no), no).toBe(false);
    }
  });

  it("usesTailwindDirectives lee el CSS con su parser, como Tailwind: comentarios, cadenas y capas nativas no cuentan", () => {
    // Lo que una regex sobre el texto contaba de más.
    for (const no of [
      "/* aquí iría un @apply */ body { color: red }",
      '.a::after { content: "@layer base" }',
      "@layer reset { a { color: red } }",
      "@layer reset, base;",
      ".a { width: calc(100% - 1px) }",
      ".a { ", // CSS roto: no se adivina, va como <link> (el navegador es tolerante)
    ]) {
      expect(usesTailwindDirectives(no), no).toBe(false);
    }
    // Y lo que sí es de Tailwind, también anidado.
    for (const si of [
      "@media (min-width: 1px) { .a { @apply p-2 } }",
      "@layer components { .btn { color: red } }",
      ".a { margin: screen(md) }",
    ]) {
      expect(usesTailwindDirectives(si), si).toBe(true);
    }
  });

  it("un módulo CSS (import x from \"./a.css\") es un error claro", () => {
    const r = compilarFuente("/src/main.jsx", 'import estilos from "./index.css";\nestilos;', app(CARPETA));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores[0]!.mensaje).toMatch(/CSS modules are not supported/);
  });

  it("un JSON importado lleva with { type: \"json\" } y su ruta real", () => {
    const js = ok(compilarFuente("/src/App.tsx", 'import menu from "./datos/menu.json";\nexport default menu;', app(CARPETA)));
    expect(js).toContain('import menu from "/src/datos/menu.json" with { type: "json" };');
  });

  it("lo que no es código, ni hoja, ni JSON, ni de URL (.svg, .txt, .md) no se importa: se dice que vaya por URL", () => {
    // Un .svg SÍ se importa desde el plan 02 (es su URL, como en Vite): ver
    // «ficheros como módulo». Aquí, una extensión que el compilador no conoce.
    const r = compilarFuente("/src/App.tsx", 'import foto from "./foto.png";\nfoto;', app({ ...CARPETA, "/src/foto.png": "x" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores[0]!.mensaje).toMatch(/Reference it by its URL/);
  });

  it("import(variable) no se toca: no se puede saber aquí", () => {
    const js = ok(compilarFuente("/src/App.tsx", "export const cargar = (n: string) => import(n);", app(CARPETA)));
    expect(js).toContain("import(n)");
  });
});

describe("los nombres que se importan de un paquete (D3)", () => {
  const CARPETA = { "/src/App.jsx": "" };
  const errores = (f: string) => {
    const r = compilarFuente("/src/App.jsx", f, app(CARPETA));
    return r.ok ? [] : r.errores;
  };

  it("lo que el paquete exporta pasa, con y sin alias, por los dos nombres del router", () => {
    expect(errores('import React, { useState as uS } from "react";\nReact; uS;')).toEqual([]);
    expect(errores('import { HashRouter, Routes, Route, Link } from "react-router-dom";\nHashRouter; Routes; Route; Link;')).toEqual([]);
    expect(errores('import { useNavigate } from "react-router";\nuseNavigate;')).toEqual([]);
    expect(errores('export { NavLink } from "react-router-dom";')).toEqual([]);
    // El nombre viejo y el nuevo de lucide, y el sufijo Icon: los tres.
    expect(errores('import { CheckCircle2, CircleCheck, CoffeeIcon, ShoppingCart } from "lucide-react";\nCheckCircle2; CircleCheck; CoffeeIcon; ShoppingCart;')).toEqual([]);
    // Lo que añade el propio compilador (el runtime de JSX) también existe.
    expect(errores("export default function A() { return <><b>x</b><i>y</i></>; }")).toEqual([]);
  });

  it("🔴 un icono que no está es un error con su línea y los parecidos que sí hay", () => {
    const e = errores('import { useState } from "react";\nimport { Coffe, Plus } from "lucide-react";\nCoffe; Plus; useState;');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ ruta: "/src/App.jsx", linea: 2 });
    expect(e[0]!.mensaje).toMatch(/"Coffe" is not one of the icons available here/);
    expect(e[0]!.mensaje).toMatch(/Closest: Coffee\b/);
    expect(e[0]!.mensaje).toMatch(/inline <svg>/);
  });

  it("🔴 BrowserRouter no está, y el error dice que las pantallas van por hash", () => {
    const e = errores('import { BrowserRouter, Routes } from "react-router-dom";\nBrowserRouter; Routes;');
    expect(e).toHaveLength(1);
    expect(e[0]!.mensaje).toMatch(/"BrowserRouter" is not available from "react-router-dom": .*hash routes.*use HashRouter/);
  });

  it("los routers de datos tampoco, y se dice cómo hacerlo", () => {
    const e = errores('import { createHashRouter, RouterProvider, useLoaderData } from "react-router-dom";\ncreateHashRouter; RouterProvider; useLoaderData;');
    expect(e).toHaveLength(3);
    for (const x of e) expect(x.mensaje).toMatch(/data routers .* <HashRouter> with <Routes>/);
  });

  it("un default que no existe, y un nombre que no es de ningún sitio", () => {
    expect(errores('import Router from "react-router-dom";\nRouter;')[0]!.mensaje).toMatch(/has no default export here: import what you need by name/);
    expect(errores('import { useStat } from "react";\nuseStat;')[0]!.mensaje).toMatch(/"react" has no export named "useStat" here\. Closest: useState/);
  });

  it("import * as y los import() no se pueden comprobar: pasan", () => {
    expect(errores('import * as Iconos from "lucide-react";\nIconos;')).toEqual([]);
    expect(errores('const m = import("lucide-react");\nm;')).toEqual([]);
  });
});

describe("import.meta.env", () => {
  it("se sustituye por los valores públicos del proyecto, más MODE/DEV/PROD", () => {
    const f = "export const url = import.meta.env.VITE_SUPABASE_URL;\nexport const dev = import.meta.env.DEV;";
    const js = ok(compilarFuente("/src/lib/supabase.ts", f, app({}, { VITE_SUPABASE_URL: "https://abc.openlen.app" })));
    expect(js).not.toContain("import.meta.env");
    const env = new Function(`return ${js.split("\n")[0]!.replace("export const url = ", "").replace(/\.VITE_SUPABASE_URL;$/, "")}`)() as Record<string, unknown>;
    expect(env).toMatchObject({ VITE_SUPABASE_URL: "https://abc.openlen.app", MODE: "production", DEV: false, PROD: true });
  });

  it("import.meta.url y el resto de import.meta siguen como están", () => {
    expect(ok(compilarFuente("/src/a.ts", "export const u = import.meta.url;", app({})))).toContain("import.meta.url");
  });
});

describe("la caché", () => {
  it("lo mismo devuelve lo mismo", () => {
    const ctx = app({ "/src/App.tsx": "" });
    expect(compilarFuente("/src/main.jsx", 'import "./App";', ctx)).toBe(compilarFuente("/src/main.jsx", 'import "./App";', ctx));
  });

  it("🔴 un fichero nuevo en la carpeta cambia la resolución: no se sirve lo de antes", () => {
    const f = 'import a from "./Nuevo";\na;';
    expect(compilarFuente("/src/main.jsx", f, app({})).ok).toBe(false);
    expect(compilarFuente("/src/main.jsx", f, app({ "/src/Nuevo.jsx": "" })).ok).toBe(true);
  });

  it("🔴 una hoja que pasa a usar @apply cambia el módulo que la importa: no se sirve el <link> de antes", () => {
    const f = 'import "./index.css";';
    const antes = ok(compilarFuente("/src/main.jsx", f, app({ "/src/index.css": "body{}" })));
    expect(antes).toContain("l.href=");
    const despues = ok(compilarFuente("/src/main.jsx", f, app({ "/src/index.css": "body { @apply bg-red-500; }" })));
    expect(despues).toContain('s.type="text/tailwindcss"');
    const otraVez = ok(compilarFuente("/src/main.jsx", f, app({ "/src/index.css": "body { @apply bg-blue-500; }" })));
    expect(otraVez).toContain("bg-blue-500");
  });
});

describe("compilarCarpeta", () => {
  const CARPETA = {
    "/index.html": "<div id=root></div>",
    "/src/main.jsx": 'import App from "./App";\nimport "./index.css";\nApp;',
    "/src/App.tsx": 'import Boton from "@/components/Boton";\nexport default () => <Boton />;',
    "/src/components/Boton.jsx": "export default () => <button>ok</button>;",
    "/src/Huerfano.jsx": "export default 1;",
    "/src/index.css": "body{}",
    "/data/menu.json": "[]",
  };

  it("compila los fuentes y deja el resto tal cual", () => {
    const r = compilarCarpeta(app(CARPETA));
    expect(r.errores).toEqual([]);
    expect(r.ficheros["/src/App.tsx"]).toContain('from "/src/components/Boton.jsx"');
    expect(r.ficheros["/src/index.css"]).toBe("body{}");
    expect(r.ficheros["/data/menu.json"]).toBe("[]");
  });

  it("un fuente que no compila NO se sirve a medias: falta, y su error está", () => {
    const r = compilarCarpeta(app({ ...CARPETA, "/src/App.tsx": "export default () => <div" }));
    expect(r.ficheros["/src/App.tsx"]).toBeUndefined();
    expect(r.errores.map((e) => e.ruta)).toEqual(["/src/App.tsx"]);
  });

  it("🔴 un nombre que otro fichero del proyecto ya no exporta es un error del que importa, con su línea", () => {
    const r = compilarCarpeta({
      ...app({
        "/src/main.jsx": 'import App from "./App";\nimport { Cesta, Total } from "./carrito";\nApp; Cesta; Total;',
        "/src/App.jsx": "export default () => null;",
        "/src/carrito.js": "export const Carrito = 1;\nexport function Total() {}",
      }),
    });
    expect(r.errores).toEqual([
      { ruta: "/src/main.jsx", linea: 2, columna: null, mensaje: '/src/carrito.js has no export named "Cesta": it exports Carrito, Total.' },
    ]);
  });

  it("un default que el otro fichero no tiene, también; y un export * no se puede comprobar", () => {
    const r = compilarCarpeta({
      ...app({
        "/src/main.jsx": 'import x from "./a";\nimport { lo } from "./b";\nx; lo;',
        "/src/a.js": "export const y = 1;",
        "/src/b.js": 'export * from "./a";',
      }),
    });
    expect(r.errores.map((e) => e.mensaje)).toEqual(["/src/a.js has no default export: it exports y, by name."]);
  });

  it("en una página, un /js/app.js con un import sin extensión se sirve como está", () => {
    const r = compilarCarpeta({ carpeta: { "/js/app.js": 'import "./x";' }, catalogo: null });
    expect(r.ficheros["/js/app.js"]).toBe('import "./x";');
    expect(r.errores).toEqual([]);
  });
});

describe("una app nacida en 2026-10 sigue con su catálogo", () => {
  it("compila contra 2026-10 aunque el actual sea otro, y no ve los paquetes nuevos", () => {
    const viejo = { carpeta: { "/src/main.jsx": "" }, catalogo: "2026-10" };
    expect(compilarFuente("/src/main.jsx", 'import { useState } from "react";\nuseState;', viejo).ok).toBe(true);
    const r = compilarFuente("/src/main.jsx", 'import { z } from "zod";\nz;', viejo);
    expect(r.ok).toBe(false);
  });
});

describe("ficheros como módulo, como en Vite (plan 02, tarea 2)", () => {
  const carpeta = {
    "/src/App.jsx": "",
    "/src/assets/logo.svg": "<svg/>",
    "/src/notas.md": '# Hola\n"comillas"',
    "/src/datos.json": '{"a":1}',
  };

  it("un .svg (y .txt, .md, .webmanifest) por defecto es SU URL, con las líneas en su sitio", () => {
    const js = ok(compilarFuente("/src/App.jsx", 'import logo from "./assets/logo.svg";\nexport const a = logo;', app(carpeta)));
    expect(js).toContain('const logo = "/src/assets/logo.svg";');
    expect(js.split("\n")[1]).toContain("export const a = logo");
  });

  it("?raw es el TEXTO del fichero; ?url es su ruta (también de un .json)", () => {
    const js = ok(compilarFuente("/src/App.jsx", 'import n from "@/notas.md?raw";\nimport u from "./datos.json?url";', app(carpeta)));
    expect(js).toContain(`const n = ${JSON.stringify('# Hola\n"comillas"')};`);
    expect(js).toContain('const u = "/src/datos.json";');
  });

  it("🔴 sin un nombre por defecto, dinámico, o con otra consulta: un error con su línea (Review Focus del plan 02)", () => {
    for (const [codigo, linea] of [
      ['\nimport { logo } from "./assets/logo.svg";', 2],
      ['const x = 1;\nconst y = import("./assets/logo.svg");', 2],
      ['import x from "./assets/logo.svg?inline";', 1],
      ['import x from "./no-esta.md?raw";', 1],
    ] as const) {
      const r = compilarFuente("/src/App.jsx", codigo, app(carpeta));
      expect(r.ok, codigo).toBe(false);
      if (!r.ok) expect(r.errores[0]!.linea, codigo).toBe(linea);
    }
  });

  it("🔴 ?raw lleva el texto de OTRO fichero: si ése cambia, lo compilado cambia (la caché no lo sirve viejo)", () => {
    const antes = ok(compilarFuente("/src/App.jsx", 'import n from "./notas.md?raw";', app(carpeta)));
    const despues = ok(compilarFuente("/src/App.jsx", 'import n from "./notas.md?raw";', app({ ...carpeta, "/src/notas.md": "otra cosa" })));
    expect(antes).toContain("Hola");
    expect(despues).toContain("otra cosa");
  });

  it('BRAZO DE CONTROL: un .json sin consulta sigue siendo su contenido (with { type: "json" })', () => {
    const js = ok(compilarFuente("/src/App.jsx", 'import d from "./datos.json";', app(carpeta)));
    expect(js).toContain('with { type: "json" }');
  });
});
