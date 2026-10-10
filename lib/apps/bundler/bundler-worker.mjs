// lib/apps/bundler/bundler-worker.mjs — EL EMPAQUETADOR, en su hilo (plan 02).
//
// esbuild-wasm EN PROCESO: su API de Node (`lib/main.js`) CREA UN PROCESO
// (`node wasm_exec_node.js esbuild.wasm`, medido el 2026-10-08), así que aquí
// va su build de NAVEGADOR (`lib/browser.js`) con `worker: false`, que corre el
// wasm en este mismo hilo. Pide un `self` (lo da `globalThis`) y su sistema de
// ficheros es de mentira (ENOSYS en todo): no toca el disco. Lo del catálogo lo
// lee ESTE fichero, sólo de su carpeta.
//
// Lo que entra son los módulos YA COMPILADOS (`compilarCarpeta`: imports
// resueltos a rutas, JSX y TS traducidos, las hojas como JS), así que el
// compilador sigue siendo la única puerta de los diagnósticos. Lo de
// `/src` va en el espacio «app»; lo del catálogo, en «vendor» con su ruta
// pública (`/openlen/vendor/<catálogo>/<fichero>`), que es lo que dirá el
// sourcemap.
//
// Las PRUEBAS de una app (plan 04) pasan por aquí también: varias entradas
// (una por fichero de prueba) en UNA construcción, módulos virtuales (el
// runtime `vitest`, la parte izada de cada prueba, sus entradas) y los
// módulos SIMULADOS (`vi.mock`): quien importa uno recibe el simulado, salvo
// el propio simulado (`<id>?original`), que pide el real.
//
// Mensajes: `{ id, entries, modules, virtual, mocked, empty, catalogFiles,
// vendorRoots, minify, nodeEnv, sourcemap }` → `{ id, ok, result: { outputs,
// errors, ms } }` (`outputs`: nombre del fichero de salida → su texto).
import cp from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { parentPort } from "node:worker_threads";

// EL CINTURÓN: este hilo no crea procesos. Si algo lo intenta, falla aquí.
for (const k of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  cp[k] = () => {
    throw new Error("the bundler thread does not create processes");
  };
}
syncBuiltinESMExports();

globalThis.self ??= globalThis;
const require = createRequire(import.meta.url);
const esbuild = require("esbuild-wasm/lib/browser.js");
const listo = esbuild.initialize({
  wasmModule: new WebAssembly.Module(readFileSync(require.resolve("esbuild-wasm/esbuild.wasm"))),
  worker: false,
});

const ORIGINAL = "?original";

// Los ficheros del catálogo y del kit no cambian nunca: se leen una vez. Cada
// ruta pública (`/openlen/vendor/2026-11/react.js`) es de UNA raíz.
const leidos = new Map();
function delVendor(m, ruta) {
  const prefijo = Object.keys(m.vendorRoots).find((p) => ruta.startsWith(p));
  if (!prefijo) throw new Error(`not a catalog file: ${ruta}`);
  const dir = m.vendorRoots[prefijo];
  const fichero = path.join(dir, ruta.slice(prefijo.length));
  if (!fichero.startsWith(dir + path.sep)) throw new Error(`outside the catalog: ${ruta}`);
  if (!leidos.has(fichero)) leidos.set(fichero, readFileSync(fichero, "utf8"));
  return leidos.get(fichero);
}

function carpetaYCatalogo(m) {
  return {
    name: "openlen",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => {
        if (a.kind === "entry-point") return { path: a.path, namespace: Object.hasOwn(m.virtual, a.path) ? "virtual" : "app" };
        const original = a.path.endsWith(ORIGINAL);
        const id = original ? a.path.slice(0, -ORIGINAL.length) : a.path;
        // Un módulo simulado (plan 04): quien lo importa recibe el simulado,
        // salvo el propio simulado (`importOriginal`), que pide el real.
        if (!original && m.mocked.includes(id)) return { path: id, namespace: "mock" };
        if (m.empty.includes(id)) return { path: id, namespace: "empty" };
        if (Object.hasOwn(m.virtual, id)) return { path: id, namespace: "virtual" };
        if (Object.hasOwn(m.catalogFiles, id)) return { path: m.catalogFiles[id], namespace: "vendor" };
        if (a.namespace === "vendor" && /^\.\.?\//.test(id)) {
          return { path: path.posix.join(path.posix.dirname(a.importer), id), namespace: "vendor" };
        }
        if (Object.hasOwn(m.modules, id)) return { path: id, namespace: "app" };
        return { errors: [{ text: `Cannot resolve "${a.path}" (imported from ${a.importer}).` }] };
      });
      b.onLoad({ filter: /.*/, namespace: "app" }, (a) => ({ contents: m.modules[a.path], loader: a.path.endsWith(".json") ? "json" : "js" }));
      b.onLoad({ filter: /.*/, namespace: "virtual" }, (a) => ({ contents: m.virtual[a.path], loader: "js" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: m.virtual[`mock:${a.path}`], loader: "js" }));
      b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      b.onLoad({ filter: /.*/, namespace: "vendor" }, (a) => ({ contents: delVendor(m, a.path), loader: "js" }));
    },
  };
}

// La memoria de un wasm no encoge: cada tanto se recicla el hilo (lo dice en
// su respuesta y `WorkerQueue` hace renacer otro).
const RECICLAR_TRAS = 200;
let hechos = 0;

async function empaquetar(m) {
  await listo;
  const t0 = performance.now();
  try {
    const r = await esbuild.build({
      entryPoints: m.entries,
      // 🔴 NUNCA `splitting` aquí: con él, un módulo simulado puede caer en un
      // trozo compartido que se evalúa antes que su `vi.mock` (medido, plan 04).
      // Sin él, cada entrada sale entera y lo que alcanza un `await import()` se
      // inicia perezoso y en orden.
      splitting: false,
      entryNames: "[name]",
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      outdir: "/out",
      minify: m.minify,
      sourcemap: m.sourcemap ? "external" : false,
      sourcesContent: false,
      define: { "process.env.NODE_ENV": JSON.stringify(m.nodeEnv) },
      logLevel: "silent",
      plugins: [carpetaYCatalogo(m)],
    });
    return {
      outputs: Object.fromEntries(r.outputFiles.map((f) => [path.posix.basename(f.path.replaceAll("\\", "/")), f.text])),
      errors: [],
      ms: Math.round(performance.now() - t0),
    };
  } catch (e) {
    const errors = Array.isArray(e?.errors)
      ? e.errors.map((x) => ({ file: x.location?.file ?? null, line: x.location?.line ?? null, column: x.location?.column ?? null, text: x.text }))
      : [{ file: null, line: null, column: null, text: e instanceof Error ? e.message : String(e) }];
    return { outputs: {}, errors, ms: Math.round(performance.now() - t0) };
  }
}

parentPort.on("message", async (m) => {
  let respuesta;
  try {
    respuesta = { id: m.id, ok: true, result: await empaquetar(m) };
  } catch (e) {
    respuesta = { id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const seVa = ++hechos >= RECICLAR_TRAS;
  parentPort.postMessage(seVa ? { ...respuesta, recycling: true } : respuesta);
  if (seVa) parentPort.close();
});
