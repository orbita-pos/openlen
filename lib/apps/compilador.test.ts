// @vitest-environment node
// El compilador de la app (spec local 2026-10-07-apps, §5.2): lo que los
// modelos escriben por reflejo —código «de Vite»— sale como JavaScript que un
// navegador ejecuta sin bundler, con las líneas en su sitio.
import { describe, expect, it } from "vitest";
import { compilarCarpeta, compilarFuente, esFuenteCompilable, textoDeDiagnostico, type ContextoDeCompilacion } from "./compilador";
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

  it("un módulo CSS (import x from \"./a.css\") es un error claro", () => {
    const r = compilarFuente("/src/main.jsx", 'import estilos from "./index.css";\nestilos;', app(CARPETA));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores[0]!.mensaje).toMatch(/CSS modules are not supported/);
  });

  it("un JSON importado lleva with { type: \"json\" } y su ruta real", () => {
    const js = ok(compilarFuente("/src/App.tsx", 'import menu from "./datos/menu.json";\nexport default menu;', app(CARPETA)));
    expect(js).toContain('import menu from "/src/datos/menu.json" with { type: "json" };');
  });

  it("importar un .svg no se puede: se dice que vaya por URL", () => {
    const r = compilarFuente("/src/App.tsx", 'import logo from "./logo.svg";\nlogo;', app(CARPETA));
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

  it("compila los fuentes, deja el resto tal cual y precarga lo alcanzable desde la entrada", () => {
    const r = compilarCarpeta({ ...app(CARPETA), entrada: "/src/main.jsx" });
    expect(r.errores).toEqual([]);
    expect(r.ficheros["/src/App.tsx"]).toContain('from "/src/components/Boton.jsx"');
    expect(r.ficheros["/src/index.css"]).toBe("body{}");
    expect(r.ficheros["/data/menu.json"]).toBe("[]");
    expect(r.grafo).toEqual(["/src/App.tsx", "/src/components/Boton.jsx", "/src/main.jsx"]);
    // El runtime de JSX lo pide el propio compilador en cada fichero con JSX.
    expect(r.paquetes).toEqual(["react/jsx-runtime"]);
  });

  it("un fuente que no compila NO se sirve a medias: falta, y su error está", () => {
    const r = compilarCarpeta({ ...app({ ...CARPETA, "/src/App.tsx": "export default () => <div" }), entrada: "/src/main.jsx" });
    expect(r.ficheros["/src/App.tsx"]).toBeUndefined();
    expect(r.errores.map((e) => e.ruta)).toEqual(["/src/App.tsx"]);
  });

  it("en una página, un /js/app.js con un import sin extensión se sirve como está", () => {
    const r = compilarCarpeta({ carpeta: { "/js/app.js": 'import "./x";' }, catalogo: null });
    expect(r.ficheros["/js/app.js"]).toBe('import "./x";');
    expect(r.errores).toEqual([]);
  });
});
