// lib/agent/terminal/trabajador.mjs — EL HILO DE LA TERMINAL DE LEN (F1 de
// plans/len-agente-2026).
//
// `just-bash` corre aquí y no en el hilo de la app: sin VM, sus defensas en el
// mismo proceso son «scoped best-effort» sobre Reflect, JSON y Math, y su
// documentación pide un hilo o proceso aparte cuando hace falta la protección
// completa. Aquí, además, un comando que se cuelga no se lleva consigo al
// servidor: el hilo principal lo corta (`terminal.ts`).
//
// JS plano y sin imports nuestros: es lo que carga un `Worker` tal cual.
// Mensajes: `iniciar` (los ficheros del proyecto), `exec` (un comando →
// salida, código y los ficheros del proyecto después), `poner` (dejar la
// terminal como quedó DE VERDAD tras las guardas de Write) y `perezosos`
// (volver a registrar los de sólo lectura cuando el sitio cambió).
//
// F5 · LOS FICHEROS DE SÓLO LECTURA (bajo `/.openlen`: resultados, bandeja,
// catálogo y versiones) llegan como rutas PEREZOSAS: su contenido se le pide al hilo
// principal la primera vez que un comando los lee (`{ perezoso, ruta }` →
// `{ tipo: "perezoso", pid, contenido | error }`), porque lo calculan las
// mismas funciones que las herramientas `ver_*`, con la base, y aquí no hay
// base. Nadie puede escribirlos: el sistema de ficheros va envuelto en una
// guarda que contesta EROFS, como un disco montado de sólo lectura.
//
// `supabase …` (plans/pages-backend/design.md), cuando `iniciar` dice que el
// proyecto lo tiene: la CLI corre en el hilo principal, que tiene la base. Aquí
// se le pasan los argumentos y los ficheros de `/supabase/` como están AHORA en
// la terminal (`{ supabase, args, ficheros }` → `{ tipo: "supabase", pid,
// resultado | error }`), y se escriben los que la CLI crea (`migration new`).
//
// `tsc`, `eslint`, `npx` y `npm` en UNA APP (plan 03 de plans/app-catalog-and-
// bundler), cuando `iniciar` trae `app`: TypeScript y ESLint de verdad corren
// en el hilo principal (`lib/apps/checker/`), con los ficheros del proyecto
// como están AHORA en la terminal (`{ app, program, args, ficheros }` →
// `{ tipo: "app", pid, resultado | error }`). `npm install`, `uninstall` y `ls`
// (npm abierto, spec 2026-10-13) también van allí: el hilo de la app instala de
// esm.sh y devuelve en `files` el /package.json nuevo, que se escribe aquí y el
// comando guarda como cualquier otro fichero.
//
// `git` (spec local 2026-10-15-git-for-len), cuando `iniciar` trae `git`: el repositorio vive
// en la base, así que corre en el hilo principal (`{ git, args, cwd, ficheros }` → `{ tipo:
// "git", pid, resultado | error }`); lo que escribe se escribe aquí y el comando lo guarda.
import path from "node:path";
import { parentPort } from "node:worker_threads";
import { Bash, InMemoryFs, defineCommand } from "just-bash";

const SISTEMA = /^\/(?:tmp|bin|usr|dev|proc)(?:\/|$)/;
// La misma regla que `DE_SOLO_LECTURA` en ficheros.ts (lo sujeta terminal.test.ts).
const SOLO_LECTURA = /^\/(?:\.openlen|node_modules)(?:\/|$)/;
const VARIABLES = "/tmp/.len-variables";
const DIRECTORIO = "/tmp/.len-directorio";
// Lo que pone la terminal y no es del modelo: no se arrastra entre comandos.
const PROPIAS = new Set(["PWD", "OLDPWD", "HOME", "PATH", "SHELL", "IFS", "PPID", "UID", "EUID", "HOSTNAME", "SHLVL", "OPTIND", "OPTERR", "RANDOM", "SECONDS", "LINENO", "__len_rc"]);

let bash = null;
// El sistema de ficheros SIN la guarda de sólo lectura: sólo lo usa `perezosos`.
let crudo = null;
let cwd = "/";
let variables = {};

// Lo que se le pidió al hilo principal y aún no ha vuelto.
let siguientePedido = 0;
const esperando = new Map();
function pedirAlPrincipal(ruta) {
  return new Promise((resolve, reject) => {
    const pid = ++siguientePedido;
    esperando.set(pid, { resolve, reject });
    parentPort.postMessage({ perezoso: pid, ruta });
  });
}

// LOS BINARIOS (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §5): un binario del proyecto
// llega como PUNTERO (`lib/files/blob-pointer.ts`) y aquí es un fichero PEREZOSO con sus bytes de
// verdad, que se piden al hilo principal sólo cuando un comando lo lee (`ls -la`, `cat`, `cp`).
// Lo que nadie cargó vuelve como el mismo puntero, sin bajar nada.
const BLOB_PREFIX = "\uFFFFopenlen-blob:";
const esPuntero = (c) => typeof c === "string" && c.startsWith(BLOB_PREFIX);
const textoEstricto = new TextDecoder("utf-8", { fatal: true });

/** La regla de `isBinaryBytes` (lib/files/blob-pointer.ts): un NUL en los primeros 8000 bytes, o no UTF-8. */
function esBinario(bytes) {
  if (bytes.subarray(0, 8000).includes(0)) return true;
  try {
    textoEstricto.decode(bytes);
    return false;
  } catch {
    return true;
  }
}

function pedirBlob(puntero) {
  return new Promise((resolve, reject) => {
    const pid = ++siguientePedido;
    esperando.set(pid, { resolve, reject });
    parentPort.postMessage({ blob: pid, puntero });
  });
}

/** El contenido perezoso de un binario, marcado con su puntero: así se reconoce sin cargarlo. */
function perezosoDeBlob(puntero) {
  const f = () => pedirBlob(puntero);
  f.puntero = puntero;
  return f;
}

/** Escribe un fichero del proyecto: un puntero, como binario perezoso; lo demás, tal cual. */
async function escribirDelProyecto(fs, ruta, contenido) {
  await fs.mkdir(dirDe(ruta), { recursive: true });
  if (esPuntero(contenido)) crudo.writeFileLazy(ruta, perezosoDeBlob(contenido));
  else await fs.writeFile(ruta, contenido);
}

/** Un fichero del proyecto como está AHORA: el puntero de un binario sin tocar (sin cargarlo), los bytes
 *  de uno nuevo o cambiado, o el texto. `undefined` si no es un fichero. Mira la entrada perezosa por
 *  dentro (`data` de `InMemoryFs`, just-bash 3.6.0): su `stat` la cargaría para saber su tamaño. */
async function leerDelProyecto(fs, ruta) {
  const entrada = crudo.data?.get?.(ruta);
  if (entrada && typeof entrada.lazy === "function" && esPuntero(entrada.lazy.puntero)) return entrada.lazy.puntero;
  const st = await fs.stat(ruta).catch(() => null);
  if (!st?.isFile) return undefined;
  const bytes = await fs.readFileBuffer(ruta);
  return esBinario(bytes) ? bytes : textoEstricto.decode(bytes);
}

function pedirSupabase(args, ficheros, signal) {
  return new Promise((resolve, reject) => {
    const pid = ++siguientePedido;
    esperando.set(pid, { resolve, reject });
    parentPort.postMessage({ supabase: pid, args, ficheros });
    // Como `npm test` (pedirApp): si el comando se aborta (su tiempo, o
    // `timeout N supabase …`), se deja de esperar en el acto y el hilo de la app
    // para lo que arrancó, como partir el SQL en su hilo (14/10).
    const onAbort = () => {
      if (!esperando.delete(pid)) return;
      parentPort.postMessage({ cancelSupabase: pid });
      reject(ABORTADO);
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function pedirFuncion(peticion) {
  return new Promise((resolve, reject) => {
    const pid = ++siguientePedido;
    esperando.set(pid, { resolve, reject });
    parentPort.postMessage({ funcion: pid, peticion });
  });
}

function pedirGit(args, cwd, ficheros) {
  return new Promise((resolve, reject) => {
    const pid = ++siguientePedido;
    esperando.set(pid, { resolve, reject });
    parentPort.postMessage({ git: pid, args, cwd, ficheros });
  });
}

// GIT FOR LEN (spec local 2026-10-15-git-for-len): `git` runs in the app's thread, which has the
// repository; here it gets the project's files as they are NOW, and what it writes is written
// here so the command's save takes it through Write's checks, like anything a command writes.
const comandoGit = defineCommand("git", async (args, ctx) => {
  const ficheros = {};
  for (const ruta of crudo.getAllPaths()) {
    if (SISTEMA.test(ruta) || SOLO_LECTURA.test(ruta)) continue;
    const c = await leerDelProyecto(ctx.fs, ruta);
    if (c !== undefined) ficheros[ruta] = c;
  }
  let r;
  try {
    r = await pedirGit(args, ctx.cwd, ficheros);
  } catch (e) {
    return { stdout: "", stderr: `fatal: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 128 };
  }
  for (const [ruta, contenido] of Object.entries(r.write ?? {})) {
    if (SISTEMA.test(ruta) || SOLO_LECTURA.test(ruta)) continue;
    if (contenido === null) await ctx.fs.rm(ruta, { force: true });
    else await escribirDelProyecto(ctx.fs, ruta, contenido);
  }
  return { stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? ""), exitCode: Number(r.exitCode ?? 1) };
});

// GITHUB (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §9): `gh` runs in the app's thread, which has the
// owner's GitHub App; it gets the files as git does (its --push is a git push), and it writes none.
function askGh(args, cwd, ficheros) {
  return new Promise((resolve, reject) => {
    const pid = ++siguientePedido;
    esperando.set(pid, { resolve, reject });
    parentPort.postMessage({ gh: pid, args, cwd, ficheros });
  });
}

const ghCommand = defineCommand("gh", async (args, ctx) => {
  const ficheros = {};
  for (const ruta of crudo.getAllPaths()) {
    if (SISTEMA.test(ruta) || SOLO_LECTURA.test(ruta)) continue;
    const c = await leerDelProyecto(ctx.fs, ruta);
    if (c !== undefined) ficheros[ruta] = c;
  }
  try {
    const r = await askGh(args, ctx.cwd, ficheros);
    return { stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? ""), exitCode: Number(r.exitCode ?? 1) };
  } catch (e) {
    return { stdout: "", stderr: `gh: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 1 };
  }
});

// STRIPE (spec local 2026-10-21-stripe-integration): `stripe` runs in the app's thread, which
// has the project's key; here only its arguments and its stdin go out (a DELETE reads its "yes"
// from it, as the CLI does) and its output comes back. Like `supabase`, an aborted command stops
// waiting at once and tells the app's thread to stop.
function askStripe(args, stdin, signal) {
  return new Promise((resolve, reject) => {
    const pid = ++siguientePedido;
    esperando.set(pid, { resolve, reject });
    parentPort.postMessage({ stripe: pid, args, stdin });
    const onAbort = () => {
      if (!esperando.delete(pid)) return;
      parentPort.postMessage({ cancelStripe: pid });
      reject(ABORTADO);
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const stripeCommand = defineCommand("stripe", async (args, ctx) => {
  try {
    const r = await askStripe(args, String(ctx.stdin ?? ""), ctx.signal);
    return { stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? ""), exitCode: Number(r.exitCode ?? 1) };
  } catch (e) {
    if (e === ABORTADO) return { stdout: "", stderr: "", exitCode: 143 };
    return { stdout: "", stderr: `stripe: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 1 };
  }
});

// EL `curl` DE LAS EDGE FUNCTIONS (spec local 2026-10-11): `just-bash` trae su
// curl y acepta un `fetch` propio. Éste sólo deja las URLs de las funciones de
// ESTE proyecto y las manda al hilo de la app, que las pasa por la puerta (en el
// borrador). Nada sale a la red. Desde Shopify (spec local 2026-10-22-shopify-storefront,
// §6.2) también la Storefront API de la tienda conectada: `reaches` dice lo que alcanza.
function fetchDeFunciones(prefijos, reaches) {
  return async (url, opciones = {}) => {
    if (!prefijos.some((p) => url.startsWith(p))) {
      const alcanza = reaches ?? `this project's Edge Functions (${prefijos[prefijos.length - 1]}<name>)`;
      throw new Error(`Network access denied: ${url}: this terminal only reaches ${alcanza}`);
    }
    const h = opciones.headers;
    const headers = h && typeof h.forEach === "function" ? Object.fromEntries([...h]) : { ...(h ?? {}) };
    const cuerpo = opciones.body === undefined || opciones.body === null ? null : Buffer.from(opciones.body).toString("base64");
    const r = await pedirFuncion({ url, method: String(opciones.method ?? "GET").toUpperCase(), headers, bodyB64: cuerpo });
    return { status: r.status, statusText: r.statusText, headers: r.headers, body: new Uint8Array(Buffer.from(r.bodyB64, "base64")), url };
  };
}

const CARPETA_SUPABASE = "/supabase/";

const comandoSupabase = defineCommand("supabase", async (args, ctx) => {
  const ficheros = {};
  for (const ruta of crudo.getAllPaths()) {
    if (!ruta.startsWith(CARPETA_SUPABASE)) continue;
    const c = await leerDelProyecto(ctx.fs, ruta);
    if (c !== undefined) ficheros[ruta] = c;
  }
  let r;
  try {
    r = await pedirSupabase(args, ficheros, ctx.signal);
  } catch (e) {
    // Abortado: lo que devuelva da igual (`timeout` contesta 124), pero tiene que ser YA.
    if (e === ABORTADO) return { stdout: "", stderr: "", exitCode: 143 };
    return { stdout: "", stderr: `supabase: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 1 };
  }
  for (const [ruta, contenido] of Object.entries(r.escribir ?? {})) {
    if (!ruta.startsWith(CARPETA_SUPABASE)) continue;
    await ctx.fs.mkdir(dirDe(ruta), { recursive: true });
    await ctx.fs.writeFile(ruta, contenido);
  }
  // `functions delete` (spec local 2026-10-11): lo que la CLI borra, fuera.
  for (const ruta of r.borrar ?? []) {
    if (!ruta.startsWith(CARPETA_SUPABASE)) continue;
    await ctx.fs.rm(ruta, { force: true });
  }
  return { stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? ""), exitCode: Number(r.exitCode ?? 1) };
});

/** Se abortó el comando que esperaba al hilo de la app (`timeout N npm test`). */
const ABORTADO = Symbol("abortado");

function pedirApp(program, args, ficheros, signal) {
  return new Promise((resolve, reject) => {
    const pid = ++siguientePedido;
    esperando.set(pid, { resolve, reject });
    // Con lo que le queda al comando: `npm test` corre dentro de SU tiempo.
    parentPort.postMessage({ app: pid, program, args, ficheros, tiempoQueQueda: Math.max(0, finDelComando - Date.now()) });
    // `timeout 2 npm test`: just-bash aborta la señal de npm test y le da 25 ms
    // para acabar (`maxExtensionCleanupTimeMs` del perfil hardened); si no
    // acaba, corta el guion ENTERO y tira lo impreso. Se deja de esperar en el
    // acto, y el hilo de la app para lo que arrancó (Chromium).
    const alAbortar = () => {
      if (!esperando.delete(pid)) return;
      parentPort.postMessage({ cancelarApp: pid });
      reject(ABORTADO);
    };
    if (signal?.aborted) alAbortar();
    else signal?.addEventListener("abort", alAbortar, { once: true });
  });
}

/** Cuándo se acaba el comando que corre ahora, y cómo cortarlo antes (lo pone `ejecutar`). */
let finDelComando = 0;
let cortarElComando = () => {};
let salidaCortada = "";

/** La duración como la dice Claude Code, igual que `formatDuration` de `formato.ts` (una prueba
 *  compara los dos): `1s`, `30s`, `2m 0s`. */
function duracion(ms) {
  if (ms < 60_000) return ms === 0 ? "0s" : `${Math.floor(ms / 1000)}s`;
  let h = Math.floor(ms / 3_600_000);
  let m = Math.floor((ms % 3_600_000) / 60_000);
  let s = Math.round((ms % 60_000) / 1000);
  if (s === 60) (s = 0), m++;
  if (m === 60) (m = 0), h++;
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

/** `tsc`, `eslint`, `build`, `test` o `npm-*` sobre los ficheros del proyecto como están AHORA. */
async function correrEnLaApp(program, args, ctx) {
  const ficheros = {};
  for (const ruta of crudo.getAllPaths()) {
    if (SISTEMA.test(ruta) || SOLO_LECTURA.test(ruta)) continue;
    const c = await leerDelProyecto(ctx.fs, ruta);
    if (c !== undefined) ficheros[ruta] = c;
  }
  let r;
  try {
    r = await pedirApp(program, args, ficheros, ctx.signal);
  } catch (e) {
    // Abortado: lo que devuelva da igual (`timeout` contesta 124), pero tiene que ser YA.
    if (e === ABORTADO) return { stdout: "", stderr: "", exitCode: 143 };
    return { stdout: "", stderr: `${program}: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 1 };
  }
  // Se acabó el tiempo del comando dentro (`npm test`): se corta ENTERO, como
  // Claude Code mata a vitest y a lo que viniera detrás.
  if (r.timedOut) {
    // `just-bash` tira la salida de un guion abortado: lo impreso se guarda aquí.
    salidaCortada = String(r.stdout ?? "");
    cortarElComando();
  }
  // OPEN NPM: npm install sends back the new /package.json; written here, the
  // command's save takes it through the same gate as anything a command writes.
  for (const [ruta, contenido] of Object.entries(r.files ?? {})) {
    if (contenido === null) await ctx.fs.rm(ruta).catch(() => {});
    else await ctx.fs.writeFile(ruta, contenido);
  }
  // Y /node_modules como lo deja npm: con el paquete ya dentro, en este mismo
  // comando (`npm install three && ls node_modules/three` daba «No such file»).
  // Por el sistema sin guarda: para el comando sigue siendo de sólo lectura.
  if (Array.isArray(r.nodeModules)) {
    await crudo.rm("/node_modules", { recursive: true, force: true });
    for (const ruta of r.nodeModules) {
      await crudo.mkdir(dirDe(ruta), { recursive: true });
      crudo.writeFileLazy(ruta, () => pedirAlPrincipal(ruta));
    }
  }
  return { stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? ""), exitCode: Number(r.exitCode ?? 1) };
}

const NPM_INSTALL = ["install", "i", "add"];
const NPM_UNINSTALL = ["uninstall", "remove", "rm", "un", "r"];

// LOS COMANDOS DE PRUEBAS de la lista de Claude Code (plan 04 de las apps,
// tarea 8): `npm|yarn|pnpm|bun test`, `… run
// test`, `… run test:<x>`, `npx|bunx vitest` y `vitest` corren vitest; jest no.
const JEST = "jest isn't available here: tests run with vitest, which has the same API (vi.fn instead of jest.fn). Run npm test.\n";

/** Lo que va tras `test` (sin el `--` con que npm separa lo suyo). */
const tras = (resto) => (resto[0] === "--" ? resto.slice(1) : resto);

/** `<gestor> test …`, `<gestor> run test[:x] …`: el script de pruebas, o `null`. */
function scriptDePruebas(args) {
  const [sub, ...resto] = args;
  if (sub === "test" || sub === "t") return tras(resto);
  if ((sub === "run" || sub === "run-script") && /^test(:\S+)?$/.test(resto[0] ?? "")) return tras(resto.slice(1));
  return null;
}

/** `yarn`, `pnpm` y `bun`: las pruebas, y `add`/`remove` como `npm install`/`uninstall`. */
const gestorDePruebas = (nombre) =>
  defineCommand(nombre, (args, ctx) => {
    const suyos = scriptDePruebas(args);
    if (suyos) return correrEnLaApp("test", suyos, ctx);
    if (NPM_INSTALL.includes(args[0])) return correrEnLaApp("npm-install", args.slice(1), ctx);
    if (args[0] === "remove" || args[0] === "rm") return correrEnLaApp("npm-uninstall", args.slice(1), ctx);
    return {
      stdout: "",
      stderr: `${nombre} ${args[0] ?? ""}: not available here; use npm install, npm test, npm run build or npm run lint.\n`,
      exitCode: 1,
    };
  });

/** `grep -r` en una app no entra en /node_modules si no se nombra: como el Grep
 *  de Claude Code (ripgrep, que respeta el .gitignore), y como su `rg` aquí. Sin
 *  esto, `grep -rn x /` calculaba y enseñaba los .d.ts de cada paquete. */
function recorreSinNombrarNodeModules(args) {
  const recursivo = args.some((a) => a === "--recursive" || a === "--dereference-recursive" || /^-[A-Za-z]*[rR][A-Za-z]*$/.test(a));
  return recursivo && !args.some((a) => !a.startsWith("-") && a.includes("node_modules"));
}

const comandosDeApp = [
  defineCommand("grep", (args, ctx) => ctx.origCommand(recorreSinNombrarNodeModules(args) ? ["--exclude-dir=node_modules", ...args] : args)),
  defineCommand("tsc", (args, ctx) => correrEnLaApp("tsc", args, ctx)),
  defineCommand("eslint", (args, ctx) => correrEnLaApp("eslint", args, ctx)),
  defineCommand("vitest", (args, ctx) => correrEnLaApp("test", args, ctx)),
  defineCommand("jest", () => ({ stdout: "", stderr: JEST, exitCode: 1 })),
  gestorDePruebas("yarn"),
  gestorDePruebas("pnpm"),
  gestorDePruebas("bun"),
  defineCommand("bunx", (args, ctx) => {
    const [programa, ...suyos] = args;
    if (programa === "vitest") return correrEnLaApp("test", suyos, ctx);
    if (programa === "jest") return { stdout: "", stderr: JEST, exitCode: 1 };
    return { stdout: "", stderr: `bunx: ${programa ?? "(nothing)"} isn't available here: there is no Node to run it. To add a package to the app: npm install <name>.\n`, exitCode: 1 };
  }),
  defineCommand("npx", (args, ctx) => {
    // Las opciones de npx (`--yes`, `-y`) van antes del programa.
    const desde = args.findIndex((x) => !x.startsWith("-"));
    const [programa, ...suyos] = desde < 0 ? [] : args.slice(desde);
    if (programa === "tsc" || programa === "eslint") return correrEnLaApp(programa, suyos, ctx);
    if (programa === "vitest") return correrEnLaApp("test", suyos, ctx);
    if (programa === "jest") return { stdout: "", stderr: JEST, exitCode: 1 };
    return {
      stdout: "",
      stderr: `npx: ${programa ?? "(nothing)"} isn't available here: there is no Node to run it. To add a package to the app: npm install <name>.\n`,
      exitCode: 1,
    };
  }),
  defineCommand("npm", (args, ctx) => {
    const [sub, ...resto] = args;
    if (NPM_INSTALL.includes(sub)) return correrEnLaApp("npm-install", resto, ctx);
    if (NPM_UNINSTALL.includes(sub)) return correrEnLaApp("npm-uninstall", resto, ctx);
    if (sub === "ls" || sub === "list") return correrEnLaApp("npm-ls", resto, ctx);
    const pruebas = scriptDePruebas(args);
    if (pruebas) return correrEnLaApp("test", pruebas, ctx);
    if (sub === "run" || sub === "run-script") {
      const [script] = resto;
      if (script === "lint") return correrEnLaApp("eslint", ["."], ctx);
      if (script === "typecheck" || script === "type-check") return correrEnLaApp("tsc", ["--noEmit"], ctx);
      if (script === "build") return correrEnLaApp("build", [], ctx);
      return { stdout: "", stderr: `npm run ${script ?? ""}: not available here. The scripts are: lint, typecheck, build, test.\n`, exitCode: 1 };
    }
    return { stdout: "", stderr: `npm ${sub ?? ""}: not available here.\n`, exitCode: 1 };
  }),
];

// Las rutas que la guarda rechazó en el comando que está corriendo.
let rechazadas = new Set();

function rechazo(ruta) {
  rechazadas.add(path.posix.resolve("/", ruta));
  const e = new Error(`EROFS: read-only file system, '${ruta}'`);
  e.code = "EROFS";
  return e;
}

/**
 * `sed -i` y `tee` cuentan CUALQUIER fallo al escribir como «No such file or
 * directory» (just-bash 3.6.0), también el EROFS de la guarda: Len leería que
 * el fichero no existe, cuando existe y no se puede escribir. Si la guarda
 * rechazó esa ruta en este comando, se dice lo que diría bash con un disco de
 * sólo lectura. Un fichero que de verdad no existe sigue diciendo lo suyo.
 *
 * `python3` (2026-10-03) tiene el mismo defecto con otra cara: su puente con
 * estos ficheros convierte el EROFS en `OSError: [Errno 29] I/O error`, sin
 * ruta. Se dice lo que diría CPython en un disco de sólo lectura, con la ruta
 * cuando la guarda rechazó una sola. (Si el script no cierra el fichero, el
 * error salta al salir, CPython lo ignora y el código es 0: el fichero tampoco
 * cambia, lo sujeta terminal.test.ts.)
 */
function conElMotivoReal(stderr, dirs) {
  if (rechazadas.size === 0) return stderr;
  const rejectedPath = rechazadas.size === 1 ? `: '${[...rechazadas][0]}'` : "";
  return stderr
    .replace(/^([^:\n]+): (.+): No such file or directory$/gm, (linea, quien, ruta) =>
      dirs.some((d) => rechazadas.has(path.posix.resolve(d, ruta))) ? `${quien}: ${ruta}: Read-only file system` : linea,
    )
    .replace(/^OSError: \[Errno 29\] I\/O error$/gm, `OSError: [Errno 30] Read-only file system${rejectedPath}`);
}

/**
 * La guarda de sólo lectura sobre el sistema de ficheros en memoria. Mira la
 * ruta pedida y, si existe, la REAL (un enlace simbólico no es una puerta
 * trasera), y la carpeta que la contiene (un enlace a la carpeta tampoco).
 */
function conSoloLectura(base) {
  const prohibida = async (ruta) => {
    if (typeof ruta !== "string") return false;
    const absoluta = path.posix.resolve("/", ruta);
    if (SOLO_LECTURA.test(absoluta)) return true;
    for (const candidata of [absoluta, path.posix.dirname(absoluta)]) {
      try {
        if (SOLO_LECTURA.test(await base.realpath(candidata))) return true;
      } catch {
        // No existe todavía: nada a lo que apunte.
      }
    }
    return false;
  };
  const destinoDelEnlace = (objetivo, enlace) =>
    path.posix.resolve(path.posix.dirname(path.posix.resolve("/", enlace)), objetivo);
  // Qué argumentos de cada operación ESCRIBEN.
  const ESCRIBEN = {
    writeFile: [0],
    appendFile: [0],
    createExclusive: [0],
    rm: [0],
    chmod: [0],
    utimes: [0],
    mkdir: [0],
    cp: [1],
    mv: [0, 1],
    link: [0, 1],
  };
  return new Proxy(base, {
    get(objetivo, clave, receptor) {
      const valor = Reflect.get(objetivo, clave, receptor);
      if (typeof valor !== "function") return valor;
      if (clave === "symlink") {
        return async (destino, enlace) => {
          if ((await prohibida(enlace)) || SOLO_LECTURA.test(destinoDelEnlace(destino, enlace))) throw rechazo(enlace);
          return valor.call(objetivo, destino, enlace);
        };
      }
      const indices = ESCRIBEN[clave];
      if (!indices) return valor.bind(objetivo);
      return async (...args) => {
        for (const i of indices) if (await prohibida(args[i])) throw rechazo(args[i]);
        return valor.apply(objetivo, args);
      };
    },
  });
}

function dirDe(ruta) {
  const i = ruta.lastIndexOf("/");
  return i <= 0 ? "/" : ruta.slice(0, i);
}

/** Las variables de `declare -p`, para la llamada siguiente (las listas no: no viajan por `env`). */
function leerVariables(texto) {
  const out = {};
  for (const linea of texto.split("\n")) {
    const m = /^declare -[-a-zA-Z]* ([A-Za-z_][A-Za-z0-9_]*)="(.*)"$/.exec(linea);
    if (!m || PROPIAS.has(m[1]) || m[1].startsWith("BASH")) continue;
    out[m[1]] = m[2].replace(/\\(["\\$`])/g, "$1");
  }
  return out;
}

async function delProyecto() {
  const out = {};
  for (const ruta of bash.fs.getAllPaths()) {
    // Lo de sólo lectura no es del proyecto, y leerlo aquí lo calcularía entero.
    if (SISTEMA.test(ruta) || SOLO_LECTURA.test(ruta)) continue;
    const c = await leerDelProyecto(bash.fs, ruta);
    if (c !== undefined) out[ruta] = c;
  }
  return out;
}

async function iniciar(m) {
  const ficheros = { ...m.ficheros };
  for (const [ruta, contenido] of Object.entries(ficheros)) if (esPuntero(contenido)) ficheros[ruta] = perezosoDeBlob(contenido);
  for (const ruta of m.perezosos ?? []) ficheros[ruta] = () => pedirAlPrincipal(ruta);
  crudo = new InMemoryFs(ficheros);
  bash = new Bash({
    fs: conSoloLectura(crudo),
    cwd: "/",
    // `~` es el HOME de la memoria de la persona (`HOME_DIR` de
    // lib/agent/ficheros/len-md.ts): `cat ~/.len/LEN.md` abre su LEN.md. El de
    // just-bash por defecto es «/».
    env: { HOME: "/home/user" },
    // Sin `network` ni `javascript`. `curl` sólo existe con funciones, y sólo
    // hacia ellas (`fetchDeFunciones`).
    //
    // `python3` SÍ desde el 2026-10-03 (Jesús: «como lo hace DeepSeek», cuya
    // terminal es un Linux con Python). Es CPython 3.13 compilado a WASM: sólo
    // la librería estándar, sin pip y sin red, y escribe en estos mismos
    // ficheros, así que lo que cambia pasa por las guardas de Write como
    // cualquier otro comando. Su memoria tiene techo propio, 512 MB por
    // llamada (`getHeapMax` del build), comprobado: pedir 700 MB da
    // MemoryError y la terminal sigue viva. Cada llamada cuesta ~250 ms.
    python: true,
    ...(m.functions ? { fetch: fetchDeFunciones(m.functions.prefixes, m.functions.reaches) } : {}),
    customCommands: [
      ...(m.supabase ? [comandoSupabase] : []),
      ...(m.app ? comandosDeApp : []),
      ...(m.git ? [comandoGit] : []),
      ...(m.gh ? [ghCommand] : []),
      ...(m.stripe ? [stripeCommand] : []),
    ],
    executionLimitProfile: "hardened",
    executionLimits: { maxExecutionTimeMs: m.limiteMs },
  });
  await bash.fs.mkdir("/tmp", { recursive: true });
  cwd = "/";
  variables = {};
  return {};
}

async function ejecutar(m) {
  // El directorio y las variables sobreviven entre comandos, como en la
  // terminal de DeepSeek; las funciones no, porque `just-bash` no las sabe
  // imprimir (`declare -f` sale vacío). El epílogo va en líneas propias para no
  // mover los números de línea de los errores del comando.
  const guion = `${m.command}\n__len_rc=$?\ndeclare -p > ${VARIABLES} 2>/dev/null\npwd > ${DIRECTORIO}\nexit $__len_rc`;
  const dirAlEmpezar = cwd;
  rechazadas = new Set();
  let r;
  // EL TIEMPO DE CADA COMANDO, como el `Bash` de Claude Code (plan 04 de las
  // apps, tarea 7): 120 s por defecto y hasta 600 s si se pide; lo pone
  // `terminal.ts` en `m.limiteMs`. El techo de `just-bash` es el máximo.
  const corte = new AbortController();
  const señal = AbortSignal.any([AbortSignal.timeout(m.limiteMs), corte.signal]);
  cortarElComando = () => corte.abort();
  salidaCortada = "";
  finDelComando = Date.now() + m.limiteMs;
  try {
    r = await bash.exec(guion, { cwd, env: variables, signal: señal });
  } catch (e) {
    // Una REDIRECCIÓN (`>`, `>>`) cuya escritura falla no le llega al comando
    // como error de shell: `just-bash` 3.6.0 deja escapar la excepción y corta
    // el guion entero (medido con EROFS, EACCES y EPERM). La de sólo lectura se
    // cuenta como lo contaría bash; lo demás sigue siendo un fallo de verdad.
    if (señal.aborted) r = { stdout: "", stderr: "", exitCode: 143 };
    else if (e instanceof Error && e.code === "EROFS") r = { stdout: "", stderr: `bash: ${e.message}\n`, exitCode: 1 };
    else throw e;
  }
  if (señal.aborted) {
    // Como Claude Code: el aviso delante de lo que alcanzó a escribir, y 143 (SIGTERM).
    const aviso = `Command timed out after ${duracion(m.limiteMs)}`;
    // Lo de antes del corte, `just-bash` 3.6.0 lo tira (medido); lo de `npm test` se guardó al cortar.
    return { stdout: salidaCortada ? `${aviso} ${salidaCortada}` : aviso, stderr: "", exitCode: 143, ficheros: await delProyecto() };
  }
  try {
    variables = leerVariables(await bash.fs.readFile(VARIABLES));
    const dir = (await bash.fs.readFile(DIRECTORIO)).trim();
    if (dir.startsWith("/")) cwd = dir;
  } catch {
    // `exit` en el comando se salta el epílogo: se queda lo de antes.
  }
  return { stdout: r.stdout, stderr: conElMotivoReal(r.stderr, [dirAlEmpezar, cwd]), exitCode: r.exitCode, ficheros: await delProyecto() };
}

async function poner(m) {
  for (const [ruta, contenido] of Object.entries(m.ficheros)) {
    if (contenido === null) await bash.fs.rm(ruta, { force: true });
    else await escribirDelProyecto(bash.fs, ruta, contenido);
  }
  return {};
}

/**
 * Lo de sólo lectura, otra vez: lo que ya se leyó se olvida y vuelve perezoso,
 * con las rutas de AHORA. Sin esto `/.openlen/versiones` no enseñaba las
 * versiones guardadas en el mismo turno. Por el sistema sin guarda: para la
 * terminal sigue siendo de sólo lectura.
 */
async function perezosos(m) {
  await crudo.rm("/.openlen", { recursive: true, force: true });
  await crudo.rm("/node_modules", { recursive: true, force: true });
  for (const ruta of m.perezosos ?? []) {
    await crudo.mkdir(dirDe(ruta), { recursive: true });
    crudo.writeFileLazy(ruta, () => pedirAlPrincipal(ruta));
  }
  return {};
}

const MANEJADORES = { iniciar, exec: ejecutar, poner, perezosos };

parentPort.on("message", async (m) => {
  if (m.tipo === "perezoso") {
    const p = esperando.get(m.pid);
    esperando.delete(m.pid);
    if (!p) return;
    if (typeof m.contenido === "string") p.resolve(m.contenido);
    else p.reject(new Error(m.error ?? `could not read ${m.ruta ?? "the file"}`));
    return;
  }
  if (m.tipo === "blob") {
    const p = esperando.get(m.pid);
    esperando.delete(m.pid);
    if (!p) return;
    if (m.bytes instanceof Uint8Array) p.resolve(m.bytes);
    else p.reject(new Error(m.error ?? "could not read the file's bytes"));
    return;
  }
  if (m.tipo === "funcion") {
    const p = esperando.get(m.pid);
    esperando.delete(m.pid);
    if (!p) return;
    if (m.resultado) p.resolve(m.resultado);
    else p.reject(new Error(m.error ?? "the Edge Function call failed"));
    return;
  }
  if (m.tipo === "supabase") {
    const p = esperando.get(m.pid);
    esperando.delete(m.pid);
    if (!p) return;
    if (m.resultado) p.resolve(m.resultado);
    else p.reject(new Error(m.error ?? "the Supabase CLI failed"));
    return;
  }
  if (m.tipo === "stripe") {
    const p = esperando.get(m.pid);
    esperando.delete(m.pid);
    if (!p) return;
    if (m.resultado) p.resolve(m.resultado);
    else p.reject(new Error(m.error ?? "stripe failed"));
    return;
  }
  if (m.tipo === "git") {
    const p = esperando.get(m.pid);
    esperando.delete(m.pid);
    if (!p) return;
    if (m.resultado) p.resolve(m.resultado);
    else p.reject(new Error(m.error ?? "git failed"));
    return;
  }
  if (m.tipo === "gh") {
    const p = esperando.get(m.pid);
    esperando.delete(m.pid);
    if (!p) return;
    if (m.resultado) p.resolve(m.resultado);
    else p.reject(new Error(m.error ?? "gh failed"));
    return;
  }
  if (m.tipo === "app") {
    const p = esperando.get(m.pid);
    esperando.delete(m.pid);
    if (!p) return;
    if (m.resultado) p.resolve(m.resultado);
    else p.reject(new Error(m.error ?? "the checker failed"));
    return;
  }
  try {
    const r = await MANEJADORES[m.tipo](m);
    parentPort.postMessage({ id: m.id, ok: true, ...r });
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
