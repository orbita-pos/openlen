// scripts/functions-vendor.ts — construye UNA VEZ el catálogo de las Edge
// Functions (lib/functions/catalog.ts) en lib/functions/vendor/<catálogo>/:
// cada paquete, UN .mjs para Node (ESM, `node:*` fuera), que el empaquetador
// de las funciones mete en el paquete de cada proyecto (spec local 2026-10-11).
//
//   npm run functions:vendor                 → construye el catálogo actual
//   npm run functions:vendor -- --comprobar  → sólo comprueba (no escribe)
//
// 🔴 CONGELADO, como apps:vendor: si el catálogo ya existe y lo construido no
// es byte a byte lo guardado, NO SE ESCRIBE. Versión nueva = catálogo nuevo.
//
// POR QUÉ DOS ENTRADAS. Un paquete ESM se reexporta con `export *`. Uno CommonJS
// (mercadopago) no: `export *` sobre CJS no exporta nada con nombre en ESM, así
// que sus nombres se leen del propio paquete al construir (como las fachadas de
// React en apps-vendor.ts).
//
// POR QUÉ EL `require` DEL BANNER. Lo CommonJS que esbuild mete en un ESM llama
// a `require("crypto")`; sin un `require` en el módulo, su `__require` lanza
// «Dynamic require of "crypto" is not supported». Con éste, carga el de Node.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";

import { FUNCTIONS_CATALOG_CURRENT, functionsCatalog, type FunctionsDependency } from "../lib/functions/catalog";

const RAIZ = path.resolve(import.meta.dirname, "..");
const comprobar = process.argv.includes("--comprobar");
const nombre = FUNCTIONS_CATALOG_CURRENT;
const catalogo = functionsCatalog(nombre);
if (!catalogo) throw new Error(`no hay catálogo ${nombre}`);
const paquetes = path.join(RAIZ, "scripts", "functions-catalog", nombre);
const destino = path.join(RAIZ, "lib", "functions", "vendor", nombre);
const requireDe = createRequire(path.join(paquetes, "package.json"));

function packageJson(dep: FunctionsDependency): { version: string; type?: string; module?: string; exports?: unknown } {
  return JSON.parse(readFileSync(path.join(paquetes, "node_modules", dep.name, "package.json"), "utf8"));
}

function esEsm(dep: FunctionsDependency): boolean {
  const pj = packageJson(dep);
  if (pj.type === "module" || typeof pj.module === "string") return true;
  return JSON.stringify(pj.exports ?? null).includes('"import"');
}

function entrada(dep: FunctionsDependency): string {
  const id = JSON.stringify(dep.name);
  if (esEsm(dep)) return `import * as m from ${id};\nexport * from ${id};\nexport default (m.default ?? m);\n`;
  const mod = requireDe(dep.name) as Record<string, unknown>;
  const nombres = Object.keys(mod)
    .filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== "default")
    .sort();
  return `import m from ${id};\nexport default m;\nexport const { ${nombres.join(", ")} } = m;\n`;
}

async function construir(dep: FunctionsDependency): Promise<string> {
  const r = await build({
    stdin: { contents: entrada(dep), resolveDir: paquetes, sourcefile: `openlen-${dep.file}`, loader: "js" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node22",
    conditions: ["node", "import", "default"],
    mainFields: ["module", "main"],
    legalComments: "none",
    logLevel: "silent",
    banner: {
      js:
        `// ${dep.name}@${dep.version} — catálogo ${nombre} de las Edge Functions de OpenLen (npm run functions:vendor).\n` +
        `import { createRequire as __olCreateRequire } from "node:module";\nconst require = __olCreateRequire(import.meta.url);`,
    },
  });
  return r.outputFiles[0]!.text;
}

function licencia(dep: FunctionsDependency): string {
  const dir = path.join(paquetes, "node_modules", dep.name);
  const fichero = readdirSync(dir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
  if (fichero) return readFileSync(path.join(dir, fichero), "utf8");
  const aparte = path.join(RAIZ, "scripts", "functions-vendor-licenses", `${dep.name.replace("/", "__")}.txt`);
  if (existsSync(aparte)) return readFileSync(aparte, "utf8");
  throw new Error(`${dep.name} no trae licencia: déjala en ${path.relative(RAIZ, aparte)}`);
}

async function main(): Promise<void> {
  const salida: Record<string, string> = {};
  for (const dep of catalogo!.dependencies) {
    const v = packageJson(dep).version;
    if (v !== dep.version) throw new Error(`${dep.name}: instalada ${v}, el catálogo pide ${dep.version} (cd scripts/functions-catalog/${nombre} && npm ci)`);
    salida[dep.file] = await construir(dep);
  }
  salida["LICENCIAS.txt"] = catalogo!.dependencies.map((d) => `===== ${d.name}@${d.version} =====\n\n${licencia(d).trim()}\n`).join("\n");
  const files = Object.fromEntries(Object.entries(salida).map(([f, t]) => [f, createHash("sha256").update(t).digest("hex")]));
  salida["manifest.json"] = `${JSON.stringify({ catalog: nombre, files }, null, 2)}\n`;

  if (existsSync(destino)) {
    const distintos = Object.entries(salida)
      .filter(([f, t]) => !existsSync(path.join(destino, f)) || readFileSync(path.join(destino, f), "utf8") !== t)
      .map(([f]) => f);
    if (distintos.length > 0) {
      console.error(`🔴 El catálogo ${nombre} ya existe y saldría distinto en: ${distintos.join(", ")}. Un catálogo no se reescribe: crea uno nuevo.`);
      process.exit(1);
    }
    console.log(`catálogo ${nombre}: igual a lo guardado (${Object.keys(salida).length} ficheros)`);
    return;
  }
  if (comprobar) {
    console.error(`el catálogo ${nombre} no está construido (npm run functions:vendor)`);
    process.exit(1);
  }
  mkdirSync(destino, { recursive: true });
  for (const [f, t] of Object.entries(salida)) writeFileSync(path.join(destino, f), t);
  console.log(`catálogo ${nombre}: ${Object.keys(salida).length} ficheros en ${path.relative(RAIZ, destino)}`);
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
