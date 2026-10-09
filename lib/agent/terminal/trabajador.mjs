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
  bash = new Bash({
    fs: conSoloLectura(crudo),
    cwd: "/",
    // `~` es el HOME de la memoria de la persona (`HOME_DIR` de
    // lib/agent/ficheros/len-md.ts): `cat ~/.len/LEN.md` abre su LEN.md. El de
    // just-bash por defecto es «/».
    env: { HOME: "/home/user" },
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
    ...(m.supabase ? { customCommands: [comandoSupabase] } : {}),
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
  try {
    r = await bash.exec(guion, { cwd, env: variables });
  } catch (e) {
    // Una REDIRECCIÓN (`>`, `>>`) cuya escritura falla no le llega al comando
    // como error de shell: `just-bash` 3.6.0 deja escapar la excepción y corta
    // el guion entero (medido con EROFS, EACCES y EPERM). La de sólo lectura se
    // cuenta como lo contaría bash; lo demás sigue siendo un fallo de verdad.
    if (!(e instanceof Error) || e.code !== "EROFS") throw e;
    r = { stdout: "", stderr: `bash: ${e.message}\n`, exitCode: 1 };
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
  try {
    const r = await MANEJADORES[m.tipo](m);
    parentPort.postMessage({ id: m.id, ok: true, ...r });
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
