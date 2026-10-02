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
// salida, código y los ficheros del proyecto después) y `poner` (dejar la
// terminal como quedó DE VERDAD tras las guardas de Write).
import { parentPort } from "node:worker_threads";
import { Bash } from "just-bash";

const SISTEMA = /^\/(?:tmp|bin|usr|dev|proc)(?:\/|$)/;
const VARIABLES = "/tmp/.len-variables";
const DIRECTORIO = "/tmp/.len-directorio";
// Lo que pone la terminal y no es del modelo: no se arrastra entre comandos.
const PROPIAS = new Set(["PWD", "OLDPWD", "HOME", "PATH", "SHELL", "IFS", "PPID", "UID", "EUID", "HOSTNAME", "SHLVL", "OPTIND", "OPTERR", "RANDOM", "SECONDS", "LINENO", "__len_rc"]);

let bash = null;
let cwd = "/";
let variables = {};

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
    if (SISTEMA.test(ruta)) continue;
    const st = await bash.fs.stat(ruta).catch(() => null);
    if (!st || !st.isFile) continue;
    out[ruta] = await bash.fs.readFile(ruta);
  }
  return out;
}

async function iniciar(m) {
  bash = new Bash({
    files: m.ficheros,
    cwd: "/",
    // Sin `network` (no hay curl), sin `javascript` ni `python`.
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
  const r = await bash.exec(guion, { cwd, env: variables });
  try {
    variables = leerVariables(await bash.fs.readFile(VARIABLES));
    const dir = (await bash.fs.readFile(DIRECTORIO)).trim();
    if (dir.startsWith("/")) cwd = dir;
  } catch {
    // `exit` en el comando se salta el epílogo: se queda lo de antes.
  }
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, ficheros: await delProyecto() };
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

const MANEJADORES = { iniciar, exec: ejecutar, poner };

parentPort.on("message", async (m) => {
  try {
    const r = await MANEJADORES[m.tipo](m);
    parentPort.postMessage({ id: m.id, ok: true, ...r });
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
