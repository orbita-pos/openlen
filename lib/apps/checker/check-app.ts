// lib/apps/checker/check-app.ts — EL COMPROBADOR DE TIPOS Y LINT, desde el hilo
// de la app (plan 03): le pasa la app a `checker-worker.mjs` y espera, con tope.
//
// Fail-soft, como `diagnosticosDeLaAppTrasEscribir`: si el hilo no contesta a
// tiempo, falla o muere, el resultado es `null` y quien llama sigue sin tipos.
// Un chequeo que pasa del tope se lleva el hilo por delante (`terminate`): un
// tipo recursivo enorme no puede quedarse comiendo CPU. El siguiente renace.
import { Worker } from "node:worker_threads";
import path from "node:path";
import { directorioVendor } from "@/lib/apps/servir";
import type { CheckResult } from "./checker-core.mjs";

const RUTA_DEL_HILO = path.join(process.cwd(), "lib", "apps", "checker", "checker-worker.mjs");
const TOPE_MS = 20_000;

interface Pendiente {
  readonly resolve: (r: CheckResult | null) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

let hilo: Worker | null = null;
let siguienteId = 0;
const pendientes = new Map<number, Pendiente>();

/** Todo lo pendiente, a `null`, y el hilo fuera: el siguiente renace. */
function soltarTodo(): void {
  for (const p of pendientes.values()) {
    clearTimeout(p.timer);
    p.resolve(null);
  }
  pendientes.clear();
  const viejo = hilo;
  hilo = null;
  void viejo?.terminate();
}

function elHilo(): Worker {
  if (hilo) return hilo;
  const nuevo = new Worker(RUTA_DEL_HILO);
  nuevo.on("message", (m: { id: number; ok: boolean; result?: CheckResult }) => {
    const p = pendientes.get(m.id);
    if (!p) return;
    pendientes.delete(m.id);
    clearTimeout(p.timer);
    p.resolve(m.ok && m.result ? m.result : null);
  });
  nuevo.on("error", () => {
    if (hilo === nuevo) soltarTodo();
  });
  nuevo.on("exit", () => {
    if (hilo === nuevo) soltarTodo();
  });
  // Que un hilo ocioso no mantenga vivo el proceso (las pruebas, un script).
  nuevo.unref();
  hilo = nuevo;
  return nuevo;
}

/** Los tipos y el lint de una app, o `null` si no llegan a tiempo o algo falla. */
export function checkAppInWorker(
  input: { readonly files: Readonly<Record<string, string>>; readonly catalogo: string },
  timeoutMs = TOPE_MS,
): Promise<CheckResult | null> {
  return new Promise((resolve) => {
    let w: Worker;
    try {
      w = elHilo();
    } catch {
      resolve(null);
      return;
    }
    const id = ++siguienteId;
    const timer = setTimeout(() => {
      if (pendientes.has(id)) soltarTodo();
    }, timeoutMs);
    pendientes.set(id, { resolve, timer });
    w.postMessage({ id, files: input.files, typesPackPath: path.join(directorioVendor(), input.catalogo, "types.json") });
  });
}

/** Para las pruebas y el apagado: suelta lo pendiente y termina el hilo. */
export function stopCheckerWorker(): void {
  soltarTodo();
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
