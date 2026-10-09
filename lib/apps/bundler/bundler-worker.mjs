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
// Mensajes: `{ id, modules, entry, catalogFiles, vendorDir, vendorPrefix,
// minify, nodeEnv, sourcemap }` → `{ id, ok, result: { js, map, errors, ms } }`.
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

// Los ficheros del catálogo no cambian nunca: se leen una vez.
const leidos = new Map();
function delCatalogo(vendorDir, relativo) {
  const ruta = path.join(vendorDir, relativo);
  if (!ruta.startsWith(vendorDir + path.sep)) throw new Error(`outside the catalog: ${relativo}`);
  if (!leidos.has(ruta)) leidos.set(ruta, readFileSync(ruta, "utf8"));
  return leidos.get(ruta);
}

function carpetaYCatalogo(m) {
  return {
    name: "openlen",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => {
        if (a.kind === "entry-point") return { path: a.path, namespace: "app" };
        if (Object.hasOwn(m.catalogFiles, a.path)) return { path: m.vendorPrefix + m.catalogFiles[a.path], namespace: "vendor" };
        if (a.namespace === "vendor" && /^\.\.?\//.test(a.path)) {
          return { path: path.posix.join(path.posix.dirname(a.importer), a.path), namespace: "vendor" };
        }
        if (a.namespace === "app" && Object.hasOwn(m.modules, a.path)) return { path: a.path, namespace: "app" };
        return { errors: [{ text: `Cannot resolve "${a.path}" (imported from ${a.importer}).` }] };
      });
      b.onLoad({ filter: /.*/, namespace: "app" }, (a) => ({ contents: m.modules[a.path], loader: a.path.endsWith(".json") ? "json" : "js" }));
      b.onLoad({ filter: /.*/, namespace: "vendor" }, (a) => ({
        contents: delCatalogo(m.vendorDir, a.path.slice(m.vendorPrefix.length)),
        loader: "js",
      }));
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
      entryPoints: [m.entry],
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
      js: r.outputFiles.find((f) => f.path.endsWith(".js"))?.text ?? "",
      map: r.outputFiles.find((f) => f.path.endsWith(".js.map"))?.text ?? null,
      errors: [],
      ms: Math.round(performance.now() - t0),
    };
  } catch (e) {
    const errors = Array.isArray(e?.errors)
      ? e.errors.map((x) => ({ file: x.location?.file ?? null, line: x.location?.line ?? null, column: x.location?.column ?? null, text: x.text }))
      : [{ file: null, line: null, column: null, text: e instanceof Error ? e.message : String(e) }];
    return { js: "", map: null, errors, ms: Math.round(performance.now() - t0) };
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
