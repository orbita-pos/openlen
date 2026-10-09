// lib/apps/checker/check-app.ts — EL COMPROBADOR DE TIPOS Y LINT, desde el hilo
// de la app (plan 03): le pasa la app a `checker-worker.mjs` y espera, con tope.
//
// Fail-soft, como `diagnosticosDeLaAppTrasEscribir`: si el hilo no contesta a
// tiempo, falla o muere, el resultado es `null` y quien llama sigue sin tipos.
// Un chequeo que pasa del tope se lleva el hilo por delante (`terminate`): un
// tipo recursivo enorme no puede quedarse comiendo CPU. El siguiente renace.
//
// La cola es `WorkerQueue` (`lib/apps/worker-queue.ts`), compartida con el
// empaquetador: una petición dentro del hilo a la vez, el tope desde que entra,
// y una petición nueva con el mismo `supersedes` SUSTITUYE a la que aún espera,
// como el `geterr` de tsserver. Las de otras sesiones no se tocan (en Claude
// Code cada sesión tiene su propio servidor).
import path from "node:path";
import { directorioVendor } from "@/lib/apps/servir";
import { WorkerQueue } from "@/lib/apps/worker-queue";
import type { CheckResult } from "./checker-core.mjs";

const RUTA_DEL_HILO = path.join(process.cwd(), "lib", "apps", "checker", "checker-worker.mjs");
const TOPE_MS = 20_000;

const cola = new WorkerQueue<CheckResult>({
  workerPath: RUTA_DEL_HILO,
  // El tope duro: si un chequeo se dispara, muere el hilo y no el servidor (el
  // umbral suave, con el que el hilo se recicla solo, vive en checker-worker.mjs).
  resourceLimits: { maxOldGenerationSizeMb: 1024 },
});

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
  return cola.run(
    { files: input.files, typesPackPath: path.join(directorioVendor(), input.catalogo, "types.json") },
    { timeoutMs, ...(input.supersedes ? { supersedes: input.supersedes } : {}) },
  );
}

/** Para las pruebas y el apagado: suelta lo pendiente y termina el hilo. */
export function stopCheckerWorker(): void {
  cola.stop();
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
