// PUBLICAR UNA APP WEB (spec local docs/superpowers/specs/2026-10-07-apps-design.md,
// §5.6): la carpeta se compila antes de tocar el disco, una app que no compila
// no se publica, y desde el plan 02 la app es UN paquete de producción en su
// entrada (sus fuentes y sólo lo que usa del catálogo): sin fuentes sueltos,
// sin catálogo suelto, sin import map ni precarga.
// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/app-publish.test.ts
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";

const root = mkdtempSync(path.join(tmpdir(), "olapp-"));
process.env.PUBLISH_ROOT = root;

import { publishToDir, tailwindStylesheetsOf } from "./filesystem";
import { stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { AppNoCompilaError } from "@/lib/apps/compilador";
import { CATALOGO_ACTUAL } from "@/lib/apps/dependencias";

after(() => {
  stopBundlerWorker();
  rmSync(root, { recursive: true, force: true });
});

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
  it("🔴 la entrada es el PAQUETE de producción: sin JSX, sin tipos, con su entorno y sin un import del catálogo por su nombre", async () => {
    await publishToDir({ subdomain: "appcompilada", html: CASCARON, files: CARPETA, app: APP, entorno: { VITE_SUPABASE_URL: "https://abc.openlen.app" } });
    const main = leer("appcompilada", "src/main.jsx");
    assert.ok(!main.includes("useState<number>"), "sin tipos");
    assert.ok(main.includes("https://abc.openlen.app"), "import.meta.env sustituido");
    assert.ok(!/\bfrom\s*["']react/.test(main), "React va dentro");
    assert.ok(!/\bimport\s*["']\/src\//.test(main) && !main.includes('"/src/App.tsx"'), "App va dentro");
    assert.equal(leer("appcompilada", "src/index.css"), "body { margin: 0 }");
    assert.ok(!existe("appcompilada", "tests/app.spec.ts"), "las pruebas no se publican");
  });

  it("🔴 los demás fuentes NO salen sueltos, ni el catálogo, y el documento no lleva import map ni precarga", async () => {
    await publishToDir({ subdomain: "appdocumento", html: CASCARON, files: CARPETA, app: APP });
    assert.ok(!existe("appdocumento", "src/App.tsx"), "App.tsx va dentro del paquete");
    assert.ok(!existe("appdocumento", "src/components/Boton.jsx"), "Boton.jsx también");
    assert.ok(!existe("appdocumento", "openlen/vendor"), "sin catálogo suelto");
    const html = leer("appdocumento", "index.html");
    assert.ok(!html.includes("importmap"), "sin import map");
    assert.ok(!html.includes("modulepreload"), "sin precarga");
    assert.ok(html.includes('src="/src/main.jsx"'), "carga la entrada, que es el paquete");
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
  it("🔴 las clases del JSX se hornean, y el documento minificado no lleva import map", async () => {
    const env = process.env as Record<string, string | undefined>;
    const antes = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      await publishToDir({ subdomain: "appproduccion", html: CASCARON, files: CARPETA, app: APP });
      const html = leer("appproduccion", "index.html");
      assert.ok(!html.includes("cdn.tailwindcss.com"), "se horneó");
      assert.ok(html.includes(".ring-4"), "ring-4, sólo en el JSX");
      assert.ok(html.includes("bg-\\[\\#123456\\]"), "valor arbitrario, sólo en el JSX");
      assert.ok(!html.includes("importmap"), "sin import map");
    } finally {
      env.NODE_ENV = antes;
    }
  });
});

describe("las hojas de Tailwind de una app (apps 2026-11, tarea 2)", () => {
  it("tailwindStylesheetsOf: sólo las hojas publicables que usan Tailwind", () => {
    const hojas = tailwindStylesheetsOf([
      { path: "/src/index.css", content: "@layer base { a {} }" },
      { path: "/src/plano.css", content: "body { color: red }" },
      { path: "/src/App.jsx", content: "@apply en un comentario de JS" },
      { path: "/tests/x.css", content: "@apply p-2" },
    ]);
    assert.deepEqual(hojas, ["@layer base { a {} }"]);
  });

  it("🔴 en PRODUCCIÓN, el @apply de la hoja de la app está en el CSS horneado de la publicada", async () => {
    const env = process.env as Record<string, string | undefined>;
    const antes = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      const conHoja = [
        ...CARPETA.filter((f) => f.path !== "/src/index.css"),
        { path: "/src/index.css", content: "@tailwind base;\n@layer components { .tarjeta-de-prueba { @apply ring-8; } }" },
        // Como el CDN con el DOM, el horneado sólo emite las clases de un `@layer
        // components` que aparecen en el código: aquí, en el JSX.
        { path: "/src/Tarjeta.jsx", content: 'export default () => <div className="tarjeta-de-prueba" />;' },
      ];
      await publishToDir({ subdomain: "apphoja", html: CASCARON, files: conHoja, app: APP });
      const html = leer("apphoja", "index.html");
      assert.ok(!html.includes("cdn.tailwindcss.com"), "se horneó");
      assert.ok(html.includes(".tarjeta-de-prueba"), "la regla de la hoja está en el CSS horneado");
    } finally {
      env.NODE_ENV = antes;
    }
  });
});

describe("del catálogo, sólo lo que la app USA, dentro del paquete (plan 02)", () => {
  it("🔴 una app que no importa recharts no lleva su código; una que lo importa, sí", async () => {
    await publishToDir({ subdomain: "appmagra", html: CASCARON, files: CARPETA, app: APP });
    const conGrafica = [
      ...CARPETA.filter((f) => f.path !== "/src/components/Boton.jsx"),
      {
        path: "/src/components/Boton.jsx",
        content: 'import { BarChart, Bar } from "recharts";\nexport default function Boton() { return <BarChart width={10} height={10} data={[]}><Bar dataKey="v" /></BarChart>; }',
      },
    ];
    await publishToDir({ subdomain: "appgrafica", html: CASCARON, files: conGrafica, app: APP });
    const magra = leer("appmagra", "src/main.jsx");
    const grafica = leer("appgrafica", "src/main.jsx");
    assert.ok(!magra.includes("recharts-wrapper"), "la magra no lleva recharts");
    assert.ok(grafica.includes("recharts-wrapper"), "la de la gráfica, sí");
    assert.ok(magra.length * 2 < grafica.length, `magra ${magra.length} vs gráfica ${grafica.length}`);
  });
});
