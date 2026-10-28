// NO-REGRESIÓN (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §10 y foco 1 del plan): un proyecto de los
// de antes —una página con su carpeta web y una imagen ya subida, y una app que importa un .svg— publica EL MISMO
// árbol de release (cada ruta y el sha256 de su contenido) que antes de que la carpeta admitiera binarios. Lo
// esperado se grabó en la base del trabajo (master a93de0bc) con NOREG_WRITE=1; aquí sólo se compara.
// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/no-regresion.test.ts
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";

const root = mkdtempSync(path.join(tmpdir(), "olnoreg-"));
process.env.PUBLISH_ROOT = root;

import { publishToDir } from "./filesystem";
import { stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";

const ESPERADO = path.join(import.meta.dirname, "no-regresion.esperado.json");

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

/** Cada fichero de la release: su ruta → el sha256 de su contenido (lo que cambia de un día a otro, fuera). */
function arbol(sub: string): Record<string, string> {
  const base = releaseViva(sub);
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const rel = path.relative(base, full).split(path.sep).join("/");
        // El sitemap lleva la fecha del día: su ruta cuenta, su contenido no.
        out[rel] = rel === "sitemap.xml" ? "(fecha)" : createHash("sha256").update(readFileSync(full)).digest("hex");
      }
    }
  };
  walk(base);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

const PAGINA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Panadería</title>
<link rel="stylesheet" href="/css/site.css"></head>
<body><h1>Panadería Luna</h1><img src="https://uploads.openlen.com/uploads/abc/hero.webp" alt="pan">
<script type="module" src="/js/app.js"></script></body></html>`;
const CARPETA_PAGINA = [
  { path: "/js/app.js", content: "document.querySelector('h1').dataset.ok = '1';" },
  { path: "/css/site.css", content: "body { font-family: serif }" },
  { path: "/data/menu.json", content: '[{"pan":"barra"}]' },
  { path: "/img/logo.svg", content: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>' },
];

const APP = { catalogo: "2026-11", entrada: "/src/main.jsx" };
const CASCARON =
  '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>POS</title></head>' +
  '<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>';
const CARPETA_APP = [
  { path: "/src/main.jsx", content: 'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")).render(<App />);' },
  { path: "/src/App.jsx", content: 'import logo from "./logo.svg";\nexport default function App() { return <img src={logo} alt="logo" />; }' },
  { path: "/src/logo.svg", content: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>' },
];

describe("no-regresión: un proyecto de antes publica el mismo árbol", () => {
  it("🔴 la página con su carpeta y la app con su .svg", async () => {
    await publishToDir({ subdomain: "noreg-pagina", html: PAGINA, files: CARPETA_PAGINA });
    await publishToDir({ subdomain: "noreg-app", html: CASCARON, files: CARPETA_APP, app: APP });
    const ahora = { pagina: arbol("noreg-pagina"), app: arbol("noreg-app") };
    if (process.env.NOREG_WRITE === "1") {
      writeFileSync(ESPERADO, `${JSON.stringify(ahora, null, 2)}\n`);
      return;
    }
    assert.deepEqual(ahora, JSON.parse(readFileSync(ESPERADO, "utf8")));
  });
});
