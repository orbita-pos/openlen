// lib/apps/tests/bundle-tests.ts — LAS PRUEBAS, EMPAQUETADAS (plan 04): con el
// MISMO esbuild-wasm de la app (plan 02, en su hilo), en UNA construcción con
// una entrada por fichero de prueba y SIN `splitting` (con él, un simulado se
// evaluaba antes que su `vi.mock`: medido). Cada entrada es un paquete entero:
// el runtime (`vitest`), la parte izada de cada fichero de configuración y de
// la prueba, y lo que importan — la app, el catálogo y el kit —, con React de
// desarrollo (los mensajes enteros) y su mapa.
//
// Lo que no compila no entra: el fichero de prueba falla SOLO, con su
// diagnóstico; un módulo de la app que no compila hace fallar a las pruebas
// que lo alcanzan, no a todas (como vitest con «Failed to load»).
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "es-module-lexer/js";
import { runBundler, type BundlerMessage } from "@/lib/apps/bundler/bundle-app";
import { compilarCarpeta, type Diagnostico } from "@/lib/apps/compilador";
import { catalogo, RAIZ_VENDOR } from "@/lib/apps/dependencias";
import { directorioVendor } from "@/lib/apps/servir";
import type { AppDeProyecto } from "@/lib/projects/types";
import { compileTestFile, ORIGINAL_SUFFIX, type MockSpec } from "./compile-tests";
import { setupFilesOf } from "./test-files";
import { EMPTY_TEST_SPECIFIERS, TEST_KIT, testKitFor } from "./test-kit";

export const TESTS_PREFIX = "/openlen/tests/";
const TOPE_MS = 20_000;
const RUNTIME = path.join(process.cwd(), "lib", "apps", "tests", "vitest-runtime.js");

export interface TestBundle {
  /** `/openlen/tests/<n>.js` → su JavaScript (lo sirve el origen de medida). */
  readonly files: Readonly<Record<string, string>>;
  /** La misma clave → su sourcemap (para traducir las trazas; no se sirve). */
  readonly maps: Readonly<Record<string, string>>;
  /** Fichero de prueba → la ruta de su entrada. */
  readonly entries: Readonly<Record<string, string>>;
  readonly failed: readonly { readonly file: string; readonly errores: readonly Diagnostico[] }[];
  readonly ms: number;
}

/** El módulo que sustituye a uno simulado: pide su fábrica al runtime y
 *  exporta los MISMOS nombres que el real. */
function mockModule(m: MockSpec): string {
  const id = JSON.stringify(m.id);
  const lineas = [
    'import { __mockedModule, __missingExport } from "vitest";',
    `const m = await __mockedModule(${id}, () => import(${JSON.stringify(m.id + ORIGINAL_SUFFIX)}));`,
  ];
  if (m.hasDefault) lineas.push(`export default ("default" in m ? m.default : __missingExport(${id}, "default"));`);
  for (const n of m.exports) lineas.push(`export const ${n} = ${JSON.stringify(n)} in m ? m[${JSON.stringify(n)}] : __missingExport(${id}, ${JSON.stringify(n)});`);
  return lineas.join("\n") + "\n";
}

/** Los módulos de la app que alcanza `desde` (sus imports ya están resueltos a
 *  rutas por el compilador), parando en los que no están (no compilaron). */
function alcanza(desde: string, modulos: Readonly<Record<string, string>>, rotos: ReadonlySet<string>): string | null {
  const vistos = new Set<string>();
  const pila = [desde];
  while (pila.length > 0) {
    const m = pila.pop()!;
    if (vistos.has(m)) continue;
    vistos.add(m);
    if (rotos.has(m)) return m;
    const js = modulos[m];
    if (js === undefined) continue;
    let imports: ReturnType<typeof parse>[0];
    try {
      [imports] = parse(js);
    } catch {
      continue;
    }
    for (const imp of imports) if (typeof imp.specifier === "string" && imp.specifier.startsWith("/")) pila.push(imp.specifier);
  }
  return null;
}

export async function bundleAppTests(args: {
  readonly carpeta: Readonly<Record<string, string>>;
  readonly app: AppDeProyecto;
  readonly entorno?: Readonly<Record<string, string>>;
  readonly testFiles: readonly string[];
  readonly timeoutMs?: number;
}): Promise<TestBundle | null> {
  const { carpeta, app } = args;
  const t0 = Date.now();
  const ctx = { carpeta, catalogo: app.catalogo, ...(args.entorno ? { entorno: args.entorno } : {}) };
  const deLaApp = compilarCarpeta(ctx);
  const rotos = new Map<string, Diagnostico[]>();
  for (const e of deLaApp.errores) rotos.set(e.ruta, [...(rotos.get(e.ruta) ?? []), e]);
  const modules: Record<string, string> = { ...deLaApp.ficheros };
  const virtual: Record<string, string> = { vitest: readFileSync(RUNTIME, "utf8") };
  const mocked = new Set<string>();
  const failed: { file: string; errores: Diagnostico[] }[] = [];
  const entries: Record<string, string> = {};
  const setup = setupFilesOf(carpeta);

  const compilar = (ruta: string): boolean => {
    if (Object.hasOwn(virtual, `hoist:${ruta}`)) return true;
    const c = compileTestFile(ruta, carpeta[ruta]!, ctx);
    if (!c.ok) return false;
    modules[ruta] = c.js;
    virtual[`hoist:${ruta}`] = c.hoist;
    for (const m of c.mocks) {
      mocked.add(m.id);
      virtual[`mock:${m.id}`] = mockModule(m);
    }
    return true;
  };
  for (const s of setup) compilar(s);

  args.testFiles.forEach((file, i) => {
    const c = compileTestFile(file, carpeta[file] ?? "", ctx);
    if (!c.ok) {
      failed.push({ file, errores: [...c.errores] });
      return;
    }
    compilar(file);
    const roto = [...setup, file].map((f) => alcanza(f, modules, new Set(rotos.keys()))).find((x) => x !== null);
    if (roto) {
      failed.push({ file, errores: rotos.get(roto)! });
      return;
    }
    const cadena = [...setup, file].flatMap((f) => [`import ${JSON.stringify(`hoist:${f}`)};`, `import ${JSON.stringify(f)};`]).join("\n");
    virtual[`suite:${file}`] = cadena;
    const entrada = `${TESTS_PREFIX}${i}.js`;
    virtual[entrada] = [
      'import { __runFile, __fileFailed } from "vitest";',
      `try { await import(${JSON.stringify(`suite:${file}`)}); await __runFile(${JSON.stringify(file)}, globalThis.__openlenTestOptions ?? {}); }`,
      `catch (e) { __fileFailed(${JSON.stringify(file)}, e); }`,
    ].join("\n");
    entries[file] = entrada;
  });
  if (Object.keys(entries).length === 0) return { files: {}, maps: {}, entries, failed, ms: Date.now() - t0 };

  const kit = testKitFor(app.catalogo);
  const catalogFiles: Record<string, string> = Object.fromEntries([
    ...(catalogo(app.catalogo)?.dependencias ?? []).map((d) => [d.especificador, `${RAIZ_VENDOR}/${app.catalogo}/${d.fichero}`]),
    ...TEST_KIT.dependencias.map((d) => [d.especificador, `${RAIZ_VENDOR}/${kit}/${d.fichero}`]),
  ]);
  const mensaje: BundlerMessage = {
    entries: Object.values(entries),
    modules,
    virtual,
    mocked: [...mocked],
    empty: [...EMPTY_TEST_SPECIFIERS],
    catalogFiles,
    vendorRoots: {
      [`${RAIZ_VENDOR}/${app.catalogo}/`]: path.join(directorioVendor(), app.catalogo, "desarrollo"),
      [`${RAIZ_VENDOR}/${kit}/`]: path.join(directorioVendor(), kit, "desarrollo"),
    },
    minify: false,
    nodeEnv: "development",
    sourcemap: true,
  };
  const r = await runBundler(mensaje, args.timeoutMs ?? TOPE_MS);
  if (!r) return null;
  if (r.errors.length > 0) {
    // Un error de esbuild es de UN fichero de prueba (un nombre que el kit no
    // exporta, p. ej.): se atribuye por su ruta y ese fichero sale; si no se
    // sabe de cuál, fallan todos con él.
    const errores: Diagnostico[] = r.errors.map((e) => ({
      ruta: e.file ? e.file.replace(/^(?:app|virtual:hoist):/, "") : "/",
      linea: e.line,
      columna: e.column === null ? null : e.column + 1,
      mensaje: e.text,
    }));
    for (const file of Object.keys(entries)) failed.push({ file, errores: errores.filter((x) => x.ruta === file).length ? errores.filter((x) => x.ruta === file) : errores });
    return { files: {}, maps: {}, entries: {}, failed, ms: Date.now() - t0 };
  }
  const files: Record<string, string> = {};
  const maps: Record<string, string> = {};
  for (const [nombre, texto] of Object.entries(r.outputs)) {
    if (nombre.endsWith(".map")) maps[TESTS_PREFIX + nombre.slice(0, -4)] = texto;
    else files[TESTS_PREFIX + nombre] = texto;
  }
  return { files, maps, entries, failed, ms: Date.now() - t0 };
}
