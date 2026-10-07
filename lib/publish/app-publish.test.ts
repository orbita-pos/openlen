// PUBLICAR UNA APP WEB (spec local docs/superpowers/specs/2026-10-07-apps-design.md,
// §5.6): la carpeta se compila antes de tocar el disco, una app que no compila
// no se publica, el documento lleva el import map y la precarga, y el catálogo
// va de producción en /openlen/vendor/.
// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/app-publish.test.ts
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";

const root = mkdtempSync(path.join(tmpdir(), "olapp-"));
process.env.PUBLISH_ROOT = root;

import { publishToDir } from "./filesystem";
import { AppNoCompilaError } from "@/lib/apps/compilador";
import { CATALOGO_ACTUAL } from "@/lib/apps/dependencias";

after(() => rmSync(root, { recursive: true, force: true }));

function releaseViva(sub: string): string {
  const current = path.join(root, sub, "current");
  try {
    return path.join(root, sub, "releases", readFileSync(current, "utf8").trim());
  } catch {
    return current;
  }
}
const leer = (sub: string, rel: string) => readFileSync(path.join(releaseViva(sub), rel), "utf8");
const existe = (sub: string, rel: string) => existsSync(path.join(releaseViva(sub), rel));

const APP = { catalogo: CATALOGO_ACTUAL, entrada: "/src/main.jsx" };
const CASCARON =
  '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>POS</title>' +
  '<script src="https://cdn.tailwindcss.com"></script></head>' +
  '<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>';
const CARPETA = [
  {
    path: "/src/main.jsx",
    content: 'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./index.css";\ncreateRoot(document.getElementById("root")).render(<App />);',
  },
  {
    path: "/src/App.tsx",
    content:
      'import { useState } from "react";\nimport Boton from "@/components/Boton";\n' +
      "export default function App() {\n  const [n, setN] = useState<number>(0);\n" +
      '  return <main className="ring-4 bg-[#123456]"><h1>{import.meta.env.VITE_SUPABASE_URL}</h1><Boton onClick={() => setN(n + 1)}>{n}</Boton></main>;\n}',
  },
  { path: "/src/components/Boton.jsx", content: "export default function Boton(props) { return <button {...props} />; }" },
  { path: "/src/index.css", content: "body { margin: 0 }" },
  { path: "/tests/app.spec.ts", content: "test()" },
];

describe("publicar una app web", () => {
  it("🔴 los fuentes salen COMPILADOS en su ruta, con los imports resueltos", async () => {
    await publishToDir({ subdomain: "appcompilada", html: CASCARON, files: CARPETA, app: APP, entorno: { VITE_SUPABASE_URL: "https://abc.openlen.app" } });
    const main = leer("appcompilada", "src/main.jsx");
    assert.ok(!main.includes("<App />"), "sin JSX");
    assert.match(main, /from "\/src\/App\.tsx"/);
    const appTsx = leer("appcompilada", "src/App.tsx");
    assert.ok(!appTsx.includes("useState<number>"), "sin tipos");
    assert.ok(appTsx.includes("https://abc.openlen.app"), "import.meta.env sustituido");
    assert.equal(leer("appcompilada", "src/index.css"), "body { margin: 0 }");
    assert.ok(!existe("appcompilada", "tests/app.spec.ts"), "las pruebas no se publican");
  });

  it("el documento lleva el import map y la precarga del grafo y del catálogo", async () => {
    await publishToDir({ subdomain: "appdocumento", html: CASCARON, files: CARPETA, app: APP });
    const html = leer("appdocumento", "index.html");
    const mapa = /<script type="importmap" data-openlen-importmap>([\s\S]*?)<\/script>/.exec(html);
    assert.ok(mapa, "import map");
    assert.equal(JSON.parse(mapa![1]!).imports.react, `/openlen/vendor/${CATALOGO_ACTUAL}/react.js`);
    for (const r of ["/src/main.jsx", "/src/App.tsx", "/src/components/Boton.jsx", `/openlen/vendor/${CATALOGO_ACTUAL}/react-todo.js`]) {
      assert.ok(html.includes(`<link rel="modulepreload" href="${r}"`), `precarga ${r}`);
    }
    assert.ok(html.indexOf('type="importmap"') < html.indexOf('rel="modulepreload"'));
    assert.ok(html.indexOf('rel="modulepreload"') < html.indexOf('src="/src/main.jsx"'));
  });

  it("🔴 el catálogo va de PRODUCCIÓN, byte a byte, en /openlen/vendor/", async () => {
    await publishToDir({ subdomain: "appvendor", html: CASCARON, files: CARPETA, app: APP });
    for (const f of ["react.js", "react-todo.js", "react-dom-client.js", "react-jsx-runtime.js", "supabase-js.js"]) {
      const publicado = leer("appvendor", `openlen/vendor/${CATALOGO_ACTUAL}/${f}`);
      const fuente = readFileSync(path.join(process.cwd(), "public", "app-vendor", CATALOGO_ACTUAL, "produccion", f), "utf8");
      assert.equal(publicado, fuente, f);
    }
  });

  it("🔴 una app que NO compila no se publica, y no toca el disco", async () => {
    const rota = CARPETA.map((f) => (f.path === "/src/App.tsx" ? { ...f, content: "export default () => <div" } : f));
    await assert.rejects(
      publishToDir({ subdomain: "approta", html: CASCARON, files: rota, app: APP }),
      (err: unknown) => err instanceof AppNoCompilaError && err.errores.some((e) => e.ruta === "/src/App.tsx" && e.linea === 1),
    );
    assert.ok(!existsSync(path.join(root, "approta", "current")), "no hay release");
  });

  it("un import que no existe, o que no está en el catálogo, tampoco se publica", async () => {
    const conAxios = [...CARPETA, { path: "/src/api.js", content: 'import axios from "axios";\nexport default axios;' }];
    await assert.rejects(
      publishToDir({ subdomain: "appaxios", html: CASCARON, files: conAxios, app: APP }),
      (err: unknown) => err instanceof AppNoCompilaError && /"axios" is not available/.test(err.message),
    );
  });

  it("sin su módulo de entrada no se publica", async () => {
    await assert.rejects(
      publishToDir({ subdomain: "appsinentrada", html: CASCARON, files: CARPETA.slice(1), app: APP }),
      (err: unknown) => err instanceof AppNoCompilaError && /entry module does not exist/.test(err.message),
    );
  });

  it("un catálogo que no existe no se publica", async () => {
    await assert.rejects(publishToDir({ subdomain: "appcatalogo", html: CASCARON, files: CARPETA, app: { ...APP, catalogo: "1999-01" } }), /catálogo 1999-01/);
  });

  it("CONTRA-PRUEBA: una página no lleva import map ni catálogo, y su /js/app.js sale como está", async () => {
    await publishToDir({
      subdomain: "paginanormal",
      html: '<!doctype html><html><head><title>t</title></head><body><script src="/js/app.js"></script></body></html>',
      files: [{ path: "/js/app.js", content: 'import "./x";' }],
    });
    assert.ok(!leer("paginanormal", "index.html").includes("importmap"));
    assert.equal(leer("paginanormal", "js/app.js"), 'import "./x";');
    assert.ok(!existe("paginanormal", `openlen/vendor/${CATALOGO_ACTUAL}/react.js`));
  });
});

describe("publicar una app en PRODUCCIÓN (horneado y minificado de verdad)", () => {
  it("🔴 el import map sobrevive al minificado y las clases del JSX se hornean", async () => {
    const env = process.env as Record<string, string | undefined>;
    const antes = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      await publishToDir({ subdomain: "appproduccion", html: CASCARON, files: CARPETA, app: APP });
      const html = leer("appproduccion", "index.html");
      assert.ok(!html.includes("cdn.tailwindcss.com"), "se horneó");
      assert.ok(html.includes(".ring-4"), "ring-4, sólo en el JSX");
      assert.ok(html.includes("bg-\\[\\#123456\\]"), "valor arbitrario, sólo en el JSX");
      const mapa = /<script type=importmap data-openlen-importmap>([\s\S]*?)<\/script>|<script type="importmap" data-openlen-importmap>([\s\S]*?)<\/script>/.exec(html);
      assert.ok(mapa, "import map tras el minificado");
      assert.equal(JSON.parse((mapa![1] ?? mapa![2])!).imports["react-dom/client"], `/openlen/vendor/${CATALOGO_ACTUAL}/react-dom-client.js`);
    } finally {
      env.NODE_ENV = antes;
    }
  });
});
