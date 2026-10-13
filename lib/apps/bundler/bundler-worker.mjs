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
// vendorRoots, minify, nodeEnv, sourcemap, npm }` → `{ id, ok, result: { outputs,
// errors, ms } }` (`outputs`: nombre del fichero de salida → su texto). `npm`
// (npm abierto, spec 2026-10-13): lo que sirve el lock de esm.sh — sus módulos
// en el espacio «npm» (por su URL), sus hojas en «npm-style» y sus imágenes en
// «npm-url».
import cp from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parentPort } from "node:worker_threads";

// Las EDGE FUNCTIONS (spec local 2026-10-11) usan este MISMO hilo: un solo
// esbuild-wasm en memoria. Su resolvedor es JS puro, compartido con el TS.
import { applyImportMap, resolveSpecifier, STD_HTTP_SERVER, TYPES_ONLY } from "../../functions/bundler/resolve.mjs";

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
        // OPEN NPM (spec 2026-10-13): inside an esm.sh module, "/x", "./x" and
        // full URLs are esm.sh modules of the same origin; a bare name is the
        // catalog's (react) or another package of the app's lock.
        if (a.namespace === "npm") {
          if (/^(?:\/|\.\.?\/|https?:\/\/)/.test(id)) return { path: new URL(id, a.importer).href, namespace: "npm" };
          if (Object.hasOwn(m.catalogFiles, id)) return { path: m.catalogFiles[id], namespace: "vendor" };
          if (m.npm && Object.hasOwn(m.npm.entries, id)) return { path: m.npm.entries[id], namespace: "npm" };
          return { errors: [{ text: `Cannot resolve "${id}" (imported from ${a.importer}): it is neither in the catalog nor in /package.json.` }] };
        }
        if (m.npm && Object.hasOwn(m.npm.styles, id)) return { path: id, namespace: "npm-style" };
        if (m.npm && Object.hasOwn(m.npm.urls, id)) return { path: id, namespace: "npm-url" };
        if (Object.hasOwn(m.catalogFiles, id)) return { path: m.catalogFiles[id], namespace: "vendor" };
        if (a.namespace === "vendor" && /^\.\.?\//.test(id)) {
          return { path: path.posix.join(path.posix.dirname(a.importer), id), namespace: "vendor" };
        }
        if (m.npm && Object.hasOwn(m.npm.entries, id)) return { path: m.npm.entries[id], namespace: "npm" };
        if (Object.hasOwn(m.modules, id)) return { path: id, namespace: "app" };
        return { errors: [{ text: `Cannot resolve "${a.path}" (imported from ${a.importer}).` }] };
      });
      b.onLoad({ filter: /.*/, namespace: "app" }, (a) => ({ contents: m.modules[a.path], loader: a.path.endsWith(".json") ? "json" : "js" }));
      b.onLoad({ filter: /.*/, namespace: "virtual" }, (a) => ({ contents: m.virtual[a.path], loader: "js" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: m.virtual[`mock:${a.path}`], loader: "js" }));
      b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      b.onLoad({ filter: /.*/, namespace: "vendor" }, (a) => ({ contents: delVendor(m, a.path), loader: "js" }));
      b.onLoad({ filter: /.*/, namespace: "npm" }, (a) => {
        const code = m.npm?.modules[a.path];
        if (code === undefined) return { errors: [{ text: `${a.path} is not in the package cache. Run npm install again.` }] };
        return { contents: code, loader: "js" };
      });
      b.onLoad({ filter: /.*/, namespace: "npm-style" }, (a) => ({
        contents: `const style = document.createElement("style");\nstyle.dataset.package = ${JSON.stringify(a.path)};\nstyle.textContent = ${JSON.stringify(m.npm.styles[a.path])};\ndocument.head.appendChild(style);\n`,
        loader: "js",
      }));
      b.onLoad({ filter: /.*/, namespace: "npm-url" }, (a) => ({ contents: `export default ${JSON.stringify(m.npm.urls[a.path])};\n`, loader: "js" }));
    },
  };
}

// ── LAS EDGE FUNCTIONS ─────────────────────────────────────────────────────
// Entra: `{ kind: "functions", entry, sources, importMaps, sharedImportMap,
// catalog, vendorDir, runtimeFile, minify }`. Sale lo mismo que `empaquetar`
// más `warnings` (los avisos de versión del catálogo, con su línea).
//   · espacio «app»: los fuentes de /supabase/ (sus rutas, para las trazas);
//   · «virtual»: la entrada, el envoltorio (`openlen:runtime`), el `serve` de
//     std y el módulo vacío de los tipos;
//   · «vendor»: el catálogo, leído de su carpeta (es un .mjs entero por paquete).
// `node:*` queda FUERA: lo pone Node. Plataforma Node y `splitting`: lo que
// comparten dos funciones (stripe) va en un trozo, una vez.

const CARPETA_FUNCIONES = "/supabase/functions/";
// Deno pide la extensión; Len a veces no la escribe: OpenLen se adapta.
const EXTENSIONES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.js"];

function cargadorDe(ruta) {
  if (ruta.endsWith(".tsx")) return "tsx";
  if (ruta.endsWith(".ts")) return "ts";
  if (ruta.endsWith(".jsx")) return "jsx";
  if (ruta.endsWith(".json")) return "json";
  return "js";
}

function funcionDe(ruta) {
  if (!ruta.startsWith(CARPETA_FUNCIONES)) return null;
  const n = ruta.slice(CARPETA_FUNCIONES.length).split("/")[0];
  return n && !n.startsWith("_") ? n : null;
}

function delDisco(fichero) {
  if (!leidos.has(fichero)) leidos.set(fichero, readFileSync(fichero, "utf8"));
  return leidos.get(fichero);
}

function pluginDeFunciones(m) {
  // Lo compartido (`_shared/`) no sabe qué función lo importa: usa el mapa común.
  const mapaDe = (importer) => {
    const f = funcionDe(importer);
    return f ? (m.importMaps[f] ?? null) : (m.sharedImportMap ?? null);
  };
  return {
    name: "openlen-functions",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => {
        if (a.kind === "entry-point") return { path: "entry", namespace: "virtual" };
        if (a.path === "openlen:runtime") return { path: "runtime", namespace: "virtual" };
        if (a.path.startsWith("node:")) return { path: a.path, external: true };
        // Un fichero del catálogo ya viene empaquetado entero: lo único que
        // importa son módulos de Node, a veces sin `node:` (`"crypto"`). Fuera.
        if (a.namespace === "vendor") return { path: a.path, external: true };
        if (a.namespace === "virtual" && a.importer === "entry") return { path: a.path, namespace: "app" };
        const spec = applyImportMap(mapaDe(a.importer), a.path);
        if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) {
          const base = spec.startsWith("/") ? spec : path.posix.join(path.posix.dirname(a.importer), spec);
          for (const ext of EXTENSIONES) if (Object.hasOwn(m.sources, base + ext)) return { path: base + ext, namespace: "app" };
          return { errors: [{ text: `Module not found "${spec}".` }] };
        }
        const r = resolveSpecifier(m.catalog, spec);
        if (r.kind === "node") return { path: r.id, external: true };
        if (r.kind === "runtime") return { path: r.id, namespace: "virtual" };
        if (r.kind === "error") return { errors: [{ text: r.message }] };
        return { path: r.file, namespace: "vendor", ...(r.warning ? { warnings: [{ text: r.warning }] } : {}) };
      });
      b.onLoad({ filter: /.*/, namespace: "virtual" }, (a) => {
        if (a.path === "entry") return { contents: m.entry, loader: "js" };
        if (a.path === "runtime") return { contents: delDisco(m.runtimeFile), loader: "js" };
        if (a.path === STD_HTTP_SERVER) return { contents: "export function serve(handler, options) { return Deno.serve(options ?? {}, handler); }\n", loader: "js" };
        if (a.path === TYPES_ONLY) return { contents: "", loader: "js" };
        return { errors: [{ text: `unknown module ${a.path}` }] };
      });
      b.onLoad({ filter: /.*/, namespace: "app" }, (a) => ({ contents: m.sources[a.path], loader: cargadorDe(a.path) }));
      b.onLoad({ filter: /.*/, namespace: "vendor" }, (a) => {
        const fichero = path.join(m.vendorDir, a.path);
        if (!fichero.startsWith(m.vendorDir + path.sep)) return { errors: [{ text: `outside the catalog: ${a.path}` }] };
        return { contents: delDisco(fichero), loader: "js" };
      });
    },
  };
}

const aMensaje = (x) => ({ file: x.location?.file ?? null, line: x.location?.line ?? null, column: x.location?.column ?? null, text: x.text });

async function empaquetarFunciones(m) {
  await listo;
  const t0 = performance.now();
  try {
    const r = await esbuild.build({
      entryPoints: ["entry"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      target: "node22",
      splitting: true,
      outdir: "/out",
      entryNames: "index",
      chunkNames: "chunks/[name]-[hash]",
      outExtension: { ".js": ".mjs" },
      minify: m.minify,
      sourcemap: "external",
      sourcesContent: false,
      // El catálogo carga `require` con `createRequire(import.meta.url)`, y en
      // workerd (Cloudflare) `import.meta.url` no existe: una URL de fichero
      // fija vale para los dos motores (spec local 2026-10-12, Parte 2). Con
      // `pathToFileURL`: en Linux es `file:///bundle/index.mjs`; en Windows
      // lleva la unidad, sin la cual `createRequire` de Node la rechaza.
      define: { "import.meta.url": JSON.stringify(pathToFileURL("/bundle/index.mjs").href) },
      logLevel: "silent",
      plugins: [pluginDeFunciones(m)],
    });
    return {
      outputs: Object.fromEntries(r.outputFiles.map((f) => [f.path.replaceAll("\\", "/").replace(/^.*?\/out\//, ""), f.text])),
      errors: [],
      warnings: r.warnings.map(aMensaje),
      ms: Math.round(performance.now() - t0),
    };
  } catch (e) {
    const errors = Array.isArray(e?.errors) ? e.errors.map(aMensaje) : [{ file: null, line: null, column: null, text: e instanceof Error ? e.message : String(e) }];
    return { outputs: {}, errors, warnings: Array.isArray(e?.warnings) ? e.warnings.map(aMensaje) : [], ms: Math.round(performance.now() - t0) };
  }
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
    respuesta = { id: m.id, ok: true, result: await (m.kind === "functions" ? empaquetarFunciones(m) : empaquetar(m)) };
  } catch (e) {
    respuesta = { id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const seVa = ++hechos >= RECICLAR_TRAS;
  parentPort.postMessage(seVa ? { ...respuesta, recycling: true } : respuesta);
  if (seVa) parentPort.close();
});
