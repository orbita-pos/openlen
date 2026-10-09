// lib/apps/checker/checker-core.mjs — TIPOS Y LINT DE UNA APP, con las
// herramientas REALES (plans/app-catalog-and-bundler/03-types-and-lint.md).
//
// Como Claude Code: no hay reglas nuestras. TypeScript (su LanguageService) y
// ESLint (su Linter) sobre los ficheros del proyecto EN MEMORIA y el paquete de
// tipos del catálogo (`types.json`, de `npm run apps:vendor`). La configuración
// es la de la plantilla de Lovable —lo que el modelo ha visto—, con las
// desviaciones dichas junto a `OPCIONES` y `CONFIG`.
//
// JS plano y sin imports nuestros: lo carga un `Worker` tal cual
// (`checker-worker.mjs`), como `lib/agent/terminal/trabajador.mjs`. Lo
// prueban vitest (`checker-core.test.ts`) y el worker.
import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { Linter } = require("eslint");
const js = require("@eslint/js");
const globals = require("globals");
const reactHooks = require("eslint-plugin-react-hooks");
const tseslint = require("typescript-eslint");

/** El tsconfig.app.json de Lovable, más: `allowJs` + `checkJs: false` (nuestras
 *  apps mezclan .jsx: se resuelven, no se comprueban) y `resolveJsonModule`. */
const OPCIONES = {
  target: ts.ScriptTarget.ES2020,
  lib: ["lib.es2020.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  moduleDetection: ts.ModuleDetectionKind.Force,
  jsx: ts.JsxEmit.ReactJSX,
  useDefineForClassFields: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  isolatedModules: true,
  noEmit: true,
  strict: false,
  noImplicitAny: false,
  noUnusedLocals: false,
  noUnusedParameters: false,
  noFallthroughCasesInSwitch: false,
  baseUrl: "/",
  paths: { "@/*": ["./src/*"] },
  allowJs: true,
  checkJs: false,
  resolveJsonModule: true,
  types: [],
};
const DIR_LIB = path.dirname(ts.getDefaultLibFilePath(OPCIONES));
/** Lo que en Vite pone `vite/client` y nuestro compilador entiende. */
const RUTA_AMBIENTE = "/.openlen/app-env.d.ts";
const AMBIENTE = [
  "interface ImportMetaEnv {",
  "  readonly VITE_SUPABASE_URL: string;",
  "  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;",
  "  readonly VITE_SUPABASE_ANON_KEY: string;",
  "  readonly MODE: string;",
  "  readonly DEV: boolean;",
  "  readonly PROD: boolean;",
  "}",
  "interface ImportMeta { readonly env: ImportMetaEnv }",
  'declare module "*.css";',
  "",
].join("\n");

const FUENTE = /\.(?:tsx?|jsx?|mjs)$/;
const CON_TIPOS = /\.tsx?$/;
// Uno para todas las llamadas: los .d.ts de la librería y del catálogo se leen
// una vez (medido el 2026-10-08: ~900 ms en frío, 120–200 ms después).
const registro = ts.createDocumentRegistry();
const libs = new Map();

function leerLib(ruta) {
  const nombre = path.basename(ruta);
  if (!libs.has(nombre)) {
    const real = path.join(DIR_LIB, nombre);
    libs.set(nombre, existsSync(real) ? readFileSync(real, "utf8") : undefined);
  }
  return libs.get(nombre);
}

function version(texto) {
  return createHash("sha1")
    .update(texto ?? "")
    .digest("hex")
    .slice(0, 16);
}

function tiposDe(files, typesPack) {
  const todo = { ...typesPack, ...files, [RUTA_AMBIENTE]: AMBIENTE };
  const leer = (f) => todo[f] ?? (f.startsWith("/lib.") ? leerLib(f) : undefined);
  const claves = Object.keys(todo);
  const host = {
    getCompilationSettings: () => OPCIONES,
    getScriptFileNames: () => [RUTA_AMBIENTE, ...Object.keys(files).filter((f) => FUENTE.test(f))],
    getScriptVersion: (f) => version(leer(f)),
    getScriptSnapshot: (f) => {
      const t = leer(f);
      return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t);
    },
    getCurrentDirectory: () => "/",
    getDefaultLibFileName: (o) => "/" + path.basename(ts.getDefaultLibFilePath(o)),
    fileExists: (f) => leer(f) !== undefined,
    readFile: (f) => leer(f),
    directoryExists: (d) => {
      const dir = d.endsWith("/") ? d : d + "/";
      return d === "/" || claves.some((k) => k.startsWith(dir));
    },
    getDirectories: () => [],
  };
  const servicio = ts.createLanguageService(host, registro);
  const salida = [];
  for (const f of Object.keys(files).filter((x) => CON_TIPOS.test(x))) {
    for (const d of [...servicio.getSyntacticDiagnostics(f), ...servicio.getSemanticDiagnostics(f)]) {
      if (!d.file || d.file.fileName !== f || d.start === undefined) continue;
      const p = d.file.getLineAndCharacterOfPosition(d.start);
      salida.push({
        ruta: f,
        linea: p.line + 1,
        columna: p.character + 1,
        gravedad: "Error",
        mensaje: ts.flattenDiagnosticMessageText(d.messageText, " "),
        codigo: `TS${d.code}`,
        fuente: "typescript",
      });
    }
  }
  return salida;
}

/** El eslint.config.js de Lovable, con dos desviaciones: también los .js/.jsx
 *  (nuestro esqueleto es .jsx; Lovable sólo lintea .ts/.tsx), y ahí `ecmaVersion:
 *  "latest"` (con 2020, espree no lee `??=`), sin `no-unused-vars` (sin el
 *  plugin de React, ESLint no ve los usos en JSX: todo import de componente
 *  saldría «sin usar»). Sin `react-refresh/only-export-components`: es del HMR
 *  de Vite, que aquí no hay. */
const CONFIG = [
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: { ...js.configs.recommended.rules, ...reactHooks.configs.recommended.rules },
  },
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["**/*.{ts,tsx}"] })),
  { files: ["**/*.{ts,tsx}"], languageOptions: { ecmaVersion: 2020 }, rules: { "@typescript-eslint/no-unused-vars": "off" } },
  { files: ["**/*.{js,jsx,mjs}"], rules: { "no-unused-vars": "off" } },
];
const linter = new Linter({ configType: "flat" });

function lintDe(files) {
  const salida = [];
  for (const [f, codigo] of Object.entries(files)) {
    if (!FUENTE.test(f)) continue;
    // Relativo: con `/src/x` el Linter dice «No matching configuration».
    for (const m of linter.verify(codigo, CONFIG, f.slice(1))) {
      // Un error de sintaxis ya lo dice el compilador (tarea 4): no se repite.
      if (!m.ruleId) continue;
      salida.push({
        ruta: f,
        linea: m.line,
        columna: m.column,
        gravedad: m.severity === 2 ? "Error" : "Warning",
        mensaje: m.message,
        codigo: m.ruleId,
        fuente: "eslint",
      });
    }
  }
  return salida;
}

const orden = (a, b) => a.ruta.localeCompare(b.ruta) || a.linea - b.linea || a.columna - b.columna;

export function checkApp({ files, typesPack }) {
  return { typescript: tiposDe(files, typesPack).sort(orden), eslint: lintDe(files).sort(orden) };
}

// Los formateadores, aparte: el hilo de la app los usa sin cargar TypeScript ni ESLint.
export { formatStylish, formatTsc } from "./format.mjs";
