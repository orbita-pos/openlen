// lib/apps/checker/check-app.ts — EL COMPROBADOR DE TIPOS Y LINT, desde el hilo
// de la app (plan 03): le pasa la app a `checker-worker.mjs` y espera, con tope.
//
// Fail-soft, como `diagnosticosDeLaAppTrasEscribir`: si el hilo no contesta a
// tiempo, falla o muere, el resultado es `null` y quien llama sigue sin tipos.
// Un chequeo que pasa del tope se lleva el hilo por delante (`terminate`): un
// tipo recursivo enorme no puede quedarse comiendo CPU. El siguiente renace.
//
// LA COLA vive aquí, no en el puerto del hilo: al hilo entra UNA petición a la
// vez, y su tope cuenta desde que entra —con la cola en el puerto, las últimas
// de una cola larga caducaban esperando y mataban el hilo con todo lo
// pendiente—. Y una petición nueva con el mismo `supersedes` SUSTITUYE a la que
// aún espera, como el `geterr` de tsserver (`errorCheck.startNew` cancela el
// chequeo pendiente): para la sesión que escribió dos veces sólo vale el último
// estado. Las de otras sesiones no se tocan (en Claude Code cada sesión tiene
// su propio servidor).
import { Worker } from "node:worker_threads";
import path from "node:path";
import { directorioVendor } from "@/lib/apps/servir";
import type { CheckResult } from "./checker-core.mjs";

const RUTA_DEL_HILO = path.join(process.cwd(), "lib", "apps", "checker", "checker-worker.mjs");
const TOPE_MS = 20_000;

interface Peticion {
  readonly files: Readonly<Record<string, string>>;
  readonly typesPackPath: string;
  readonly timeoutMs: number;
  readonly supersedes?: object;
  readonly resolve: (r: CheckResult | null) => void;
}

let hilo: Worker | null = null;
let siguienteId = 0;
const cola: Peticion[] = [];
/** La que está dentro del hilo. */
let enCurso: { readonly id: number; readonly peticion: Peticion; readonly timer: ReturnType<typeof setTimeout> } | null = null;

/** Lo que está dentro del hilo, a `null`, y el hilo fuera: el siguiente renace. */
function soltarElHilo(): void {
  if (enCurso) {
    clearTimeout(enCurso.timer);
    enCurso.peticion.resolve(null);
    enCurso = null;
  }
  const viejo = hilo;
  hilo = null;
  void viejo?.terminate();
}

function elHilo(): Worker {
  if (hilo) return hilo;
  // El tope duro: si un chequeo se dispara, muere el hilo y no el servidor (el
  // umbral suave, con el que el hilo se recicla solo, vive en checker-worker.mjs).
  const nuevo = new Worker(RUTA_DEL_HILO, { resourceLimits: { maxOldGenerationSizeMb: 1024 } });
  nuevo.on("message", (m: { id: number; ok: boolean; result?: CheckResult; recycling?: boolean }) => {
    // Se recicla (su umbral de memoria): la siguiente va a un hilo nuevo.
    if (m.recycling && hilo === nuevo) hilo = null;
    if (!enCurso || enCurso.id !== m.id) return;
    clearTimeout(enCurso.timer);
    enCurso.peticion.resolve(m.ok && m.result ? m.result : null);
    enCurso = null;
    despachar();
  });
  const alMorir = () => {
    if (hilo !== nuevo) return;
    soltarElHilo();
    despachar();
  };
  nuevo.on("error", alMorir);
  nuevo.on("exit", alMorir);
  // Que un hilo ocioso no mantenga vivo el proceso (las pruebas, un script).
  nuevo.unref();
  hilo = nuevo;
  return nuevo;
}

/** Mete en el hilo la siguiente de la cola, si el hilo está libre. */
function despachar(): void {
  if (enCurso) return;
  const peticion = cola.shift();
  if (!peticion) return;
  let w: Worker;
  try {
    w = elHilo();
  } catch {
    peticion.resolve(null);
    despachar();
    return;
  }
  const id = ++siguienteId;
  const timer = setTimeout(() => {
    if (enCurso?.id !== id) return;
    soltarElHilo();
    despachar();
  }, peticion.timeoutMs);
  enCurso = { id, peticion, timer };
  w.postMessage({ id, files: peticion.files, typesPackPath: peticion.typesPackPath });
}

/** Los tipos y el lint de una app, o `null` si no llegan a tiempo, algo falla,
 *  o los sustituye otra petición con el mismo `supersedes`. */
export function checkAppInWorker(
  input: {
    readonly files: Readonly<Record<string, string>>;
    readonly catalogo: string;
    /** Quién pide (la sesión): su petición nueva sustituye a la que aún espera. */
    readonly supersedes?: object;
  },
  timeoutMs = TOPE_MS,
): Promise<CheckResult | null> {
  return new Promise((resolve) => {
    if (input.supersedes) {
      for (let i = cola.length - 1; i >= 0; i--) {
        if (cola[i]!.supersedes !== input.supersedes) continue;
        cola[i]!.resolve(null);
        cola.splice(i, 1);
      }
    }
    cola.push({
      files: input.files,
      typesPackPath: path.join(directorioVendor(), input.catalogo, "types.json"),
      timeoutMs,
      ...(input.supersedes ? { supersedes: input.supersedes } : {}),
      resolve,
    });
    despachar();
  });
}

/** Para las pruebas y el apagado: suelta lo pendiente y termina el hilo. */
export function stopCheckerWorker(): void {
  for (const p of cola.splice(0)) p.resolve(null);
  soltarElHilo();
}

/** NUNCA se llama: está para el trazador del standalone. El hilo se carga por
 *  ruta y sólo él importa las herramientas, así que el trazador no las vería (lo
 *  mismo que con just-bash). Estos `import()` literales, con los paquetes en
 *  `serverExternalPackages`, hacen que copie cada paquete CON su árbol de
 *  dependencias (las de ESLint viven sueltas en la raíz de node_modules). */
export const toolchainForTracing = () =>
  Promise.all([
    import("typescript"),
    import("eslint"),
    import("typescript-eslint"),
    import("eslint-plugin-react-hooks"),
    import("@eslint/js"),
    import("globals"),
  ]);
