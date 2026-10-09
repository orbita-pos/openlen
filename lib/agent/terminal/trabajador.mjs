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
// `{ tipo: "app", pid, resultado | error }`). `npm install` no instala nada:
// contesta con el catálogo, que es lo que hay.
import path from "node:path";
import { parentPort } from "node:worker_threads";
import { Bash, InMemoryFs, defineCommand } from "just-bash";

const SISTEMA = /^\/(?:tmp|bin|usr|dev|proc)(?:\/|$)/;
// La misma regla que `DE_SOLO_LECTURA` en ficheros.ts (lo sujeta terminal.test.ts).
const SOLO_LECTURA = /^\/\.openlen(?:\/|$)/;
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

function pedirSupabase(args, ficheros) {
  return new Promise((resolve, reject) => {
    const pid = ++siguientePedido;
    esperando.set(pid, { resolve, reject });
    parentPort.postMessage({ supabase: pid, args, ficheros });
  });
}

const CARPETA_SUPABASE = "/supabase/";

const comandoSupabase = defineCommand("supabase", async (args, ctx) => {
  const ficheros = {};
  for (const ruta of crudo.getAllPaths()) {
    if (!ruta.startsWith(CARPETA_SUPABASE)) continue;
    const st = await ctx.fs.stat(ruta).catch(() => null);
    if (st?.isFile) ficheros[ruta] = await ctx.fs.readFile(ruta);
  }
  let r;
  try {
    r = await pedirSupabase(args, ficheros);
  } catch (e) {
    return { stdout: "", stderr: `supabase: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 1 };
  }
  for (const [ruta, contenido] of Object.entries(r.escribir ?? {})) {
    if (!ruta.startsWith(CARPETA_SUPABASE)) continue;
    await ctx.fs.mkdir(dirDe(ruta), { recursive: true });
    await ctx.fs.writeFile(ruta, contenido);
  }
  return { stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? ""), exitCode: Number(r.exitCode ?? 1) };
});

function pedirApp(program, args, ficheros) {
  return new Promise((resolve, reject) => {
    const pid = ++siguientePedido;
    esperando.set(pid, { resolve, reject });
    // Con lo que le queda al comando: `npm test` corre dentro de SU tiempo.
    parentPort.postMessage({ app: pid, program, args, ficheros, tiempoQueQueda: Math.max(0, finDelComando - Date.now()) });
  });
}

/** Cuándo se acaba el comando que corre ahora (lo pone `ejecutar`). */
let finDelComando = 0;

/** El `Zt` de Claude Code, como `formatDuration` de `formato.ts` (una prueba
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

// Lo que el catálogo de la app ofrece (`react`, `date-fns/locale`…) y los
// `@types/*` que trae su paquete de tipos: lo trae `iniciar`.
let especificadoresDelCatalogo = [];
let paquetesDeTipos = [];

/** `tsc`, `eslint` o `build` sobre los ficheros del proyecto como están AHORA. */
async function correrEnLaApp(program, args, ctx) {
  const ficheros = {};
  for (const ruta of crudo.getAllPaths()) {
    if (SISTEMA.test(ruta) || SOLO_LECTURA.test(ruta)) continue;
    const st = await ctx.fs.stat(ruta).catch(() => null);
    if (st?.isFile) ficheros[ruta] = await ctx.fs.readFile(ruta);
  }
  let r;
  try {
    r = await pedirApp(program, args, ficheros);
  } catch (e) {
    return { stdout: "", stderr: `${program}: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 1 };
  }
  return { stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? ""), exitCode: Number(r.exitCode ?? 1) };
}

/** `@radix-ui/react-dialog@1.1.0` → `@radix-ui/react-dialog`; `zod@3` → `zod`. */
function sinVersion(paquete) {
  const arroba = paquete.indexOf("@", 1);
  return arroba > 0 ? paquete.slice(0, arroba) : paquete;
}

/** El paquete de un especificador: `date-fns/locale` → `date-fns`, `@a/b/c` → `@a/b`. */
function paqueteDe(especificador) {
  return especificador.split("/").slice(0, especificador.startsWith("@") ? 2 : 1).join("/");
}

function npmInstall(paquetes) {
  if (paquetes.length === 0) {
    return { stdout: "Nothing to install: the app's packages are its catalog, already available.\n", stderr: "", exitCode: 0 };
  }
  const lista = [...new Set(especificadoresDelCatalogo.map(paqueteDe))].join(", ");
  let stdout = "";
  let stderr = "";
  for (const p of paquetes.map(sinVersion)) {
    if (especificadoresDelCatalogo.some((e) => e === p || e.startsWith(`${p}/`))) stdout += `${p}: already available (catalog)\n`;
    else if (paquetesDeTipos.includes(p)) stdout += `${p}: already available (its types come with the catalog)\n`;
    else stderr += `${p}: isn't available here — there is no npm; the catalog has: ${lista}\n`;
  }
  return { stdout, stderr, exitCode: stderr ? 1 : 0 };
}

const NPM_TEST = "npm test: there is no test runner here yet.\n";

const comandosDeApp = [
  defineCommand("tsc", (args, ctx) => correrEnLaApp("tsc", args, ctx)),
  defineCommand("eslint", (args, ctx) => correrEnLaApp("eslint", args, ctx)),
  defineCommand("npx", (args, ctx) => {
    // Las opciones de npx (`--yes`, `-y`) van antes del programa.
    const desde = args.findIndex((x) => !x.startsWith("-"));
    const [programa, ...suyos] = desde < 0 ? [] : args.slice(desde);
    if (programa === "tsc" || programa === "eslint") return correrEnLaApp(programa, suyos, ctx);
    return {
      stdout: "",
      stderr: `npx: ${programa ?? "(nothing)"} isn't available here: there is no npm. The app's packages are its catalog.\n`,
      exitCode: 1,
    };
  }),
  defineCommand("npm", (args, ctx) => {
    const [sub, ...resto] = args;
    if (sub === "install" || sub === "i" || sub === "add") return npmInstall(resto.filter((a) => !a.startsWith("-")));
    if (sub === "test" || sub === "t") return { stdout: "", stderr: NPM_TEST, exitCode: 1 };
    if (sub === "run" || sub === "run-script") {
      const [script] = resto;
      if (script === "lint") return correrEnLaApp("eslint", ["."], ctx);
      if (script === "typecheck" || script === "type-check") return correrEnLaApp("tsc", ["--noEmit"], ctx);
      if (script === "build") return correrEnLaApp("build", [], ctx);
      if (script === "test") return { stdout: "", stderr: NPM_TEST, exitCode: 1 };
      return { stdout: "", stderr: `npm run ${script ?? ""}: not available here. The scripts are: lint, typecheck, build.\n`, exitCode: 1 };
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
    const st = await bash.fs.stat(ruta).catch(() => null);
    if (!st || !st.isFile) continue;
    out[ruta] = await bash.fs.readFile(ruta);
  }
  return out;
}

async function iniciar(m) {
  const ficheros = { ...m.ficheros };
  for (const ruta of m.perezosos ?? []) ficheros[ruta] = () => pedirAlPrincipal(ruta);
  crudo = new InMemoryFs(ficheros);
  especificadoresDelCatalogo = m.app?.catalogSpecifiers ?? [];
  paquetesDeTipos = m.app?.typesPackages ?? [];
  bash = new Bash({
    fs: conSoloLectura(crudo),
    cwd: "/",
    // Sin `network` (no hay curl) y sin `javascript`.
    //
    // `python3` SÍ desde el 2026-10-03 (Jesús: «como lo hace DeepSeek», cuya
    // terminal es un Linux con Python). Es CPython 3.13 compilado a WASM: sólo
    // la librería estándar, sin pip y sin red, y escribe en estos mismos
    // ficheros, así que lo que cambia pasa por las guardas de Write como
    // cualquier otro comando. Su memoria tiene techo propio, 512 MB por
    // llamada (`getHeapMax` del build), comprobado: pedir 700 MB da
    // MemoryError y la terminal sigue viva. Cada llamada cuesta ~250 ms.
    python: true,
    customCommands: [...(m.supabase ? [comandoSupabase] : []), ...(m.app ? comandosDeApp : [])],
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
  const señal = AbortSignal.timeout(m.limiteMs);
  finDelComando = Date.now() + m.limiteMs;
  try {
    r = await bash.exec(guion, { cwd, env: variables, signal: señal });
  } catch (e) {
    // Una REDIRECCIÓN (`>`, `>>`) cuya escritura falla no le llega al comando
    // como error de shell: `just-bash` 3.6.0 deja escapar la excepción y corta
    // el guion entero (medido con EROFS, EACCES y EPERM). La de sólo lectura se
    // cuenta como lo contaría bash; lo demás sigue siendo un fallo de verdad.
    if (señal.aborted) r = { stdout: "", stderr: "", exitCode: 124 };
    else if (e instanceof Error && e.code === "EROFS") r = { stdout: "", stderr: `bash: ${e.message}\n`, exitCode: 1 };
    else throw e;
  }
  if (señal.aborted) {
    // Lo que alcanzó a escribir, y el aviso de Claude Code.
    return { stdout: r.stdout ?? "", stderr: `Command timed out after ${duracion(m.limiteMs)}\n`, exitCode: 124, ficheros: await delProyecto() };
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
    if (contenido === null) {
      await bash.fs.rm(ruta, { force: true });
    } else {
      await bash.fs.mkdir(dirDe(ruta), { recursive: true });
      await bash.fs.writeFile(ruta, contenido);
    }
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
  if (m.tipo === "supabase") {
    const p = esperando.get(m.pid);
    esperando.delete(m.pid);
    if (!p) return;
    if (m.resultado) p.resolve(m.resultado);
    else p.reject(new Error(m.error ?? "the Supabase CLI failed"));
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
